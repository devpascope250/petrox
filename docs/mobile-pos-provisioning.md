# POS devices: provisioning and authentication

How a POS (the Flutter app) is registered to a site and how it authenticates afterwards.
Everything lives in `src/modules/mobile/`, served under `/api/v1/mobile`.

All responses use the API's usual envelope: `{ "success": true, "data": … }`, or
`{ "success": false, "error": { "statusCode", "code", "message", "requestId" } }`.

## The idea in one picture

```
admin ──► provisioning key (one-time, 10–30 min) ──► shown once, typed into the POS
POS   ──► POST /mobile/provision { key, deviceUuid, deviceName }
            └─ key consumed, device created for the key's site, credentials issued
POS   ──► Authorization: Bearer <accessToken>  on every request
POS   ──► POST /mobile/auth/refresh  when the access token expires
```

- The **provisioning key** is a short-lived, one-time onboarding credential. Only its
  SHA-256 hash is stored; the key itself is returned once and never logged.
- The **device credential** is separate: a 15-minute access token (JWT) plus a long-lived
  refresh token (90 days, rotated on every use, stored only as a hash).
- The **device UUID** identifies the device. It is not a secret and proves nothing on its own.

## 1. Admin: generate a key

Needs an employee session (the usual cookie) and `mobile.devices.create`. A super
administrator can do this for any site; a site manager only for his own site.

```http
POST /api/v1/mobile/sites/{siteId}/provisioning-keys
{ "expiresInMinutes": 10 }
```

`expiresInMinutes` defaults to 10 and may not exceed `MOBILE_PROVISIONING_KEY_MAX_MINUTES`
(30 by default). The site must be active.

```json
{
  "success": true,
  "data": {
    "id": "8f1c…",
    "key": "IK-7GQ2-M9XA-4KTD",
    "expiresAt": "2026-10-05T09:40:00.000Z",
    "status": "active",
    "site": { "id": "68d2…", "name": "NYABUGOGO" },
    "user": { "id": "…", "firstName": "pascal", "lastName": "NP" }
  }
}
```

`key` appears in this response only. Keys are 12 random characters (60 bits) from an
alphabet without I, L, O or U. Case, spaces and dashes don't matter when typing; O is read
as 0, and I and L as 1.

Other key endpoints:

| Method | Path | Permission | |
|---|---|---|---|
| GET | `/mobile/sites/{siteId}/provisioning-keys` | `mobile.devices.read` | The 50 most recent keys: status (`active`, `used`, `expired`, `revoked`), times, who made it, which device used it. Never the key or its hash. |
| POST | `/mobile/provisioning-keys/{keyId}/revoke` | `mobile.devices.edit` | Only an unused key can be revoked. |

## 2. POS: provision itself

No session. Limited to 5 requests per minute per IP address.

```http
POST /api/v1/mobile/provision
{
  "provisioningKey": "IK-7GQ2-M9XA-4KTD",
  "deviceUuid": "6c1f0a52-4b7e-4d0e-9a51-0f4f6f1f2c11",
  "deviceName": "POS 01"
}
```

- `deviceUuid`: 8–128 characters, letters, digits and `. _ : -`.
- `deviceName`: 1–80 characters.
- Any other field (a `siteId`, say) is rejected. The site always comes from the key.

```json
{
  "success": true,
  "data": {
    "device": { "id": "d41e…", "deviceUuid": "6c1f…", "deviceName": "POS 01", "status": "active", "provisionedAt": "…" },
    "site": { "id": "68d2…", "name": "NYABUGOGO", "address": "…", "phone": "…", "email": "…" },
    "serverTime": "2026-10-05T09:31:02.114Z",
    "version": "c9f3e514db71befa81d50e35c35ef6d6",
    "catalog": { "pumps": [], "cuves": [], "nozzles": [], "shifts": [], "accounts": [] },
    "authentication": {
      "tokenType": "Bearer",
      "accessToken": "eyJ…",
      "accessTokenExpiresIn": "15m",
      "refreshToken": "q2n…",
      "refreshTokenExpiresAt": "2027-01-03T09:31:02.114Z"
    }
  }
}
```

`catalog` is what the POS sells at its site: pumps, tanks (each with its product and price
in force), nozzles, shifts and the accounts payments go to. `version` fingerprints `site`
and `catalog` together; see section 4 for keeping them current.

What happens, in one database transaction:

1. The key is claimed with one conditional update (unused, unrevoked, unexpired). Of two
   requests racing with the same key, only one can win.
2. The site must be active.
3. The device is created. If the same `deviceUuid` was registered before and has been
   revoked, that record is registered again: to this key's site, with a new token
   version, so all its old tokens stay dead.
4. The key records which device used it.

If anything fails, all of it rolls back and the key stays usable.

Errors:

| Status | Code | When |
|---|---|---|
| 401 | `INVALID_PROVISIONING_KEY` | Unknown, used, expired or revoked key, or the site is inactive. Always the same message, so a guess learns nothing. |
| 409 | `DEVICE_ALREADY_REGISTERED` | This `deviceUuid` is registered and active. An admin must revoke it first. Which site it belongs to is not revealed. |
| 429 | — | Too many attempts. |

## 3. POS: authenticated requests

Every call sends the access token:

```http
GET /api/v1/mobile/me
Authorization: Bearer eyJ…
```

On each request the server checks the token's signature and expiry, and then the device
in the database: it must exist, be `active`, have the same token version, belong to the
site in the token, and its site must be active. Revocation therefore takes effect at once,
not when the token expires.

| Method | Path | |
|---|---|---|
| GET | `/mobile/me` | The device and its site. |
| GET | `/mobile/bootstrap` | Device, site, server time, `version` and catalog: the same shape as the provision response, without `authentication`. |
| GET | `/mobile/sync?version=…` | Whether the site data changed since that version — see below. |

Device tokens and employee tokens are signed with different keys, so neither works in
place of the other. Device tokens are read only from the `Authorization` header, never
from cookies.

## 4. POS: keep the local site data current

At provisioning (and `GET /mobile/bootstrap`) the POS receives its site data — `site`
and `catalog` — and a `version`, a fingerprint of that data. The POS stores all three
locally and works from the local copy. To find out whether the server's data has
changed since, it asks:

```http
GET /api/v1/mobile/sync?version=c9f3e514db71befa81d50e35c35ef6d6
Authorization: Bearer eyJ…
```

Nothing changed — a small answer, nothing to do:

```json
{ "success": true, "data": { "changed": false, "version": "c9f3…", "serverTime": "…" } }
```

Something changed — replace the local copy whole and store the new version:

```json
{ "success": true, "data": { "changed": true, "version": "7a01…", "serverTime": "…", "site": { … }, "catalog": { … } } }
```

- Any change to what the POS stores — a pump, nozzle, tank, price, shift, payment account
  or the site's details, added, edited, switched off or removed — gives a new version.
- Tank **levels** are not in the stored data (`catalog.cuves` carries no `balance`): they
  change with every sale and would be stale at once. The server checks stock when a sale
  is recorded.
- Without `version` the full data comes back, like a fresh bootstrap.
- The version is also sent as an `ETag`. A client that prefers HTTP caching can send
  `If-None-Match: "<version>"` instead and gets `304 Not Modified` when nothing changed.
- When to ask: on app start, when the app comes back to the foreground, and every few
  minutes while it is open (5 minutes is plenty). A 401 here means the device was revoked
  or its token expired — refresh, and provision again if the refresh fails too.

## 5. POS: refresh

When a request returns 401, or shortly before `accessTokenExpiresIn` runs out:

```http
POST /api/v1/mobile/auth/refresh
{ "refreshToken": "q2n…" }
```

```json
{ "success": true, "data": { "tokenType": "Bearer", "accessToken": "eyJ…", "accessTokenExpiresIn": "15m", "refreshToken": "new…", "refreshTokenExpiresAt": "…" } }
```

The refresh token is single-use: the response carries a new one, and the old one stops
working. Store the new one before using the new access token. A 401 from refresh means the
device was revoked, its refresh token expired, or the token was already used. The POS must
then be provisioned again with a new key. Limited to 20 requests per minute per IP address.

## 6. Admin: devices and revocation

| Method | Path | Permission | |
|---|---|---|---|
| GET | `/mobile/sites/{siteId}/devices` | `mobile.devices.read` | id, UUID, name, status, last seen, provisioned, revoked and by whom. No credentials. |
| POST | `/mobile/devices/{deviceId}/revoke` | `mobile.devices.edit` | Status becomes `revoked`, with `revokedAt` and `revokedBy`; the refresh token is cleared and the token version bumped. |

Devices are never deleted, so their history stays. A revoked device can be brought back
only by provisioning it again with a new key.

## 7. Site isolation

- A device's site is fixed when it is provisioned, from the key's site.
- Every device request takes the site from the authenticated device (`request.device.siteId`),
  never from the request. Use `deviceSite(request)` in new POS endpoints.
- If a request carries a `siteId` (for example `GET /mobile/bootstrap?siteId=…`), it is only
  compared with the device's own site; a different one is refused with
  `403 SITE_MISMATCH`.
- An access token claiming a site other than the device's stored site is rejected.
- Admins: a site manager can only create keys for, list and revoke devices of his own site,
  whatever permissions his role holds.

## 8. What the Flutter POS must store

| Value | Where | Why |
|---|---|---|
| `refreshToken` | `flutter_secure_storage` (Keychain / Android Keystore) | The device's long-lived credential. Replace it after every refresh. |
| `accessToken` | Memory (secure storage is fine too) | Lasts 15 minutes; renewed with the refresh token. |
| `device.id`, `site` | Secure storage or app storage | To show which site the POS belongs to. |
| `catalog` and its `version` | App storage (a local database) | The site data the POS works from; replaced when `/mobile/sync` says it changed. |
| `deviceUuid` | Secure storage | Generate a random UUID on first launch and keep it. Do not rely on hardware IDs. |

Never store the provisioning key after provisioning, and never put tokens in logs,
crash reports or analytics.

## 9. Permissions and configuration

- Module **Mobile Devices** (`MOBILE_DEVICES`), permissions `mobile.devices.read`,
  `.create`, `.edit` (and `.delete` and `.manage`, which nothing uses yet beyond
  `.manage` granting everything). Seeded by `pnpm prisma:seed:mobile-devices`: everything
  for System Administrator; read, create and edit for PSS MANAGER.
- `MOBILE_PROVISIONING_KEY_MAX_MINUTES` (default 30) is the longest a key may live.
- `MOBILE_DEVICE_REFRESH_TOKEN_TTL_DAYS` (default 90) is how long a refresh token lasts.
- The access token lifetime is the app's `ACCESS_TOKEN_TTL` (15m).

## 10. Audit

The backend has no audit table, so events go to the structured application log with an
`audit` field: `MOBILE_PROVISIONING_KEY_CREATED`, `MOBILE_PROVISIONING_KEY_REVOKED`,
`MOBILE_DEVICE_PROVISIONED`, `MOBILE_DEVICE_REVOKED`, `MOBILE_DEVICE_AUTHENTICATED` (on
refresh) and `MOBILE_PROVISIONING_REJECTED`. They carry ids only, never keys or tokens.

## When the server refuses the device

Every device request is checked against the database, not only the token: a revoked
device is refused on its very next request, even with a token that has not expired.
The POS must react to the error code, because it keeps working from its local copy
of the site data until the server tells it otherwise.

| Status | Code | Meaning | What the POS must do |
|---|---|---|---|
| 401 | `DEVICE_TOKEN_EXPIRED` | The access token ran out (normal, every 15 minutes). | Call `POST /mobile/auth/refresh`, then retry the request. |
| 401 | `DEVICE_REVOKED` | An admin revoked the device, or it was provisioned again elsewhere. Refreshing cannot help. | Stop selling, delete the stored tokens and local site data, show the provisioning screen. |
| 401 | `DEVICE_REFRESH_INVALID` | The refresh token is unknown, used already, expired, or cleared by a revoke. | Same as `DEVICE_REVOKED`. |
| 401 | `UNAUTHORIZED` | No token, or not a valid device token. | Same as `DEVICE_REVOKED`. |
| 403 | `SITE_INACTIVE` | The device's site has been switched off. | Stop selling and show that the site is closed; keep the credentials. |

Because a revoked POS only finds out when it calls the server, it should call
`GET /mobile/sync` regularly (on start, on returning to the foreground, and every few
minutes) even when it has nothing to send.

## Recording sales (`/mobile/transactions`)

A sale is a `GeneralTransaction`, recorded in two steps. Both take
`multipart/form-data` with device authentication; the site is always the device's own.

**1. `POST /mobile/transactions` (initiate)** returns `201` with the sale and its
`transactionCode`, e.g. `PSST20261008-092056-536` (`PSST`, then the date and time on the
server's clock, then milliseconds). Status is `initiated`. Never send `siteId`: the sale is
always recorded at the device's site, and a `siteId` field is refused with `400`.

| Field | | |
|---|---|---|
| `itemId`, `cuveId`, `pumpId`, `nozzleId` | required | The nozzle must be on that pump and draw from that tank, which must hold that item. All active. |
| `cardCopyId` | optional | The `cardCopyId` from `GET /mobile/cards/:serialNumber`. The client is taken from it. |
| `platNumber` | optional | Required when the card type has `requirePlateNumber` or `capturePlatePicture`, and must then be one of the active cars assigned to the card (`CAR_NOT_ASSIGNED_TO_CARD`), and that car's product must be `itemId` (`CAR_ITEM_MISMATCH`); spaces, dashes and case are ignored. Stored in capitals. |
| `platePicture` (file) | optional | PNG, JPG or WEBP. Required when the card type has `capturePlatePicture`. Stored as `platePictureUrl`. |
| `appVersion` | optional | |

The unit price is the item's active `ItemPrice`, fixed at this point (`PRICE_NOT_SET` if none).

For a card sale, the **main card** is marked busy (`Card.state` 1) while the sale is open,
and freed (0) when it is confirmed or cancelled. A copy spends from its main card, so while
one copy is at a pump no other copy of the same main card can start a sale. A card that is
busy is refused with `409 CARD_BUSY`, whose `data` says where it is:
`{"site": {"id", "name"}, "transactionCode", "since"}`. A sale that is never confirmed
keeps its card busy until it times out (below); the POS should still cancel a sale it abandons.

**Timeout.** A sale still `initiated` 10 minutes after it started (`MOBILE_SALE_TIMEOUT_MINUTES`)
is cancelled automatically with reason `Not confirmed in time`, and its card is freed. Every
sale returned carries `expiresAt`: when that happens, or `null` once the sale is no longer
initiated, so the POS can show a countdown. A background sweep runs every minute, and an
overdue sale is also cancelled on the spot when it is read, confirmed, or when its card is
used for a new sale. Confirming it then gets `409 TRANSACTION_EXPIRED`: start a new sale.

**2. `POST /mobile/transactions/:code/confirm`** closes the sale. In one database
transaction it takes the litres out of the tank, writes a `CuveTransaction` (sold/OUT),
records the payments and marks the sale `confirmed`. If any check fails, nothing changes.

| Field | | |
|---|---|---|
| `phone`, `pin` | required | The attendant. Must be an active user at the site. Becomes `doneBy`. |
| `quantity` | required | Litres, at most 2 decimals. `amount` = quantity × unit price. |
| `payments` | JSON array | `[{"accountId","amount","reference"?}]`. Required without a card; when sent, the amounts must add up to `amount`. |
| `referenceDoc.<n>` (file) | optional | PDF or picture for payment `n`. |
| `displayPicture` (file) | optional | Picture of the pump display. Required when the card type has `captureDisplay`. |
| `shiftId`, `comments`, `appVersion`, `printStatus` (`true`/`false`) | optional | |

Limited to 20 a minute per device. A sale can only be confirmed once: a second confirm,
including one sent at the same moment, gets `409 TRANSACTION_ALREADY_CONFIRMED`.

**Listing:** `GET /mobile/transactions?status=initiated|confirmed|cancelled` returns the site's
50 newest sales in that status, newest first; without `status`, the open (`initiated`) ones.
Each has the same full detail as a single sale: product, tank, pump, nozzle and its display,
site, the POS that recorded it, card, client (and `clientName` at the top level, `null` without a card), attendant (`doneBy`), shift, payments with
their accounts, pictures and documents, and `expiresAt`. Overdue sales are cancelled before
listing, so the initiated list only holds sales that can still be confirmed.

**Also:** `GET /mobile/transactions/:code` reads a sale back, and
`POST /mobile/transactions/:code/cancel` with `reason` cancels a sale that is still
initiated. A cancelled sale cannot be confirmed (`409 TRANSACTION_CANCELLED`).

| Status | Code | Meaning |
|---|---|---|
| 415 | `MULTIPART_REQUIRED` | The request was not sent as form data. |
| 400 | `UNSUPPORTED_FILE` / `VALIDATION_ERROR` | Wrong file type, or a field is missing or malformed. |
| 404 | `RESOURCE_NOT_FOUND` | Unknown nozzle, card or transaction code at this site. |
| 422 | `INVALID_ATTENDANT` | Wrong phone number or PIN (one answer for both). |
| 422 | `NOZZLE_NOT_ON_PUMP`, `NOZZLE_CUVE_MISMATCH`, `ITEM_CUVE_MISMATCH`, `*_INACTIVE`, `PRICE_NOT_SET` | The sale does not match the site's equipment. |
| 422 | `PLATE_NUMBER_REQUIRED`, `PLATE_PICTURE_REQUIRED`, `DISPLAY_PICTURE_REQUIRED` | The card type's rules. |
| 422 | `CAR_NOT_ASSIGNED_TO_CARD` | The plate is not one of the active cars assigned to the card. |
| 422 | `CAR_ITEM_MISMATCH` | That car runs on another product than `itemId`; `data.car.item` says which. |
| 422 | `PAYMENTS_REQUIRED`, `PAYMENTS_DO_NOT_MATCH`, `PAYMENT_REFERENCE_REQUIRED`, `ACCOUNT_*` | Payments. |
| 422 | `INSUFFICIENT_CUVE_STOCK` | The tank holds less than the quantity. |
| 409 | `CARD_BUSY` | The card's main card is in an open sale; `data.site` says where. |
| 422 | `CARD_NOT_AVAILABLE` | The card's state is neither free nor busy. |
| 409 | `TRANSACTION_EXPIRED` | The sale was not confirmed within 10 minutes and has been cancelled. |
| 409 | `TRANSACTION_ALREADY_CONFIRMED`, `TRANSACTION_CANCELLED`, `TRANSACTION_NOT_OPEN` | The sale is no longer open. |
