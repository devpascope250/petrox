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

At provisioning (and `GET /mobile/bootstrap`) the POS receives its site data — `site`,
`equipment` and `accounts` — and a `version`, a fingerprint of that data. The POS stores
it all locally and works from the local copy. To find out whether the server's data has
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
{ "success": true, "data": { "changed": true, "version": "7a01…", "serverTime": "…", "site": { … }, "equipment": { … }, "accounts": [ … ] } }
```

- `accounts` are the company's accounts a sale's money may go into: every active one,
  whichever site it belongs to, each with `id`, `code`, `name`, `type`, `requiredReference`
  and `siteId` (`null` = the whole company). **This is where the `accountId` in a sale's
  `payments` comes from** — the POS offers these and nothing else, and asks for a reference
  number when `requiredReference` is set. Accounts of type `coupon` and `card` are left out:
  the server records those itself when a sale is paid with coupons or a client's card, and
  naming one in `payments` is refused. ⚠️ An account tied to **another** site is refused when
  the sale is confirmed (`422 ACCOUNT_NOT_AT_SITE`), so a POS that only wants to offer what
  will be accepted should keep those whose `siteId` is `null` or its own site's.
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
used for a new sale. Confirming it then gets `409 TRANSACTION_EXPIRED`: start a new sale. A sale paid with coupons (below) never times out: its `expiresAt` is `null`.

**1a. `GET /mobile/transactions/:code/quote?quantity=`** — **ask this before confirming.**

A sale may carry a **discount** and a **subsidy**, and the POS cannot work either out for
itself. The quote prices the open sale at the litres the pump shows:

🔴 **Both are recorded, not deducted.** The customer pays what the pump shows; the two figures
are written down against the sale to be settled or claimed later. So `amount` — what the
attendant collects, what the `payments` must add up to, and what a card is charged — **is the
same figure as `grossAmount`**.

```json
{
  "transactionCode": "PSST20261008-092056-536",
  "client": { "id": "…", "clientCode": "C-0007", "name": "Acme Ltd" },
  "quantity": 40, "unitPrice": 1500,
  "grossAmount": 60000,
  "discountAmount": 6000,
  "amount": 60000,
  "discount": { "id": "…", "type": "fixed", "rate": 10, "amount": 6000, "tier": null },
  "subsidyAmount": 9600,
  "subsidy": { "id": "…", "rate": 240, "amount": 9600, "car": { "id": "…", "plateNo": "RAD 123 A" } }
}
```

- `grossAmount` is quantity × price — what the pump display shows.
- `discountAmount` is what the discount comes to; `0` and `discount: null` when none applies.
- **`amount` is what the attendant collects** — the gross, since nothing is deducted.
- `discount.rate` is **a percentage of the sale**: a rate of 10 on a gross of 60,000 is 6,000
  off. Worked to two decimals — 11.34 litres at 1,764 is 20,003.76, and 10% of that is
  2,000.38 off, leaving 18,003.38. `discount.tier` is the volume band that gave the rate
  (`{id, from, to}`), or `null` for a client's own rate; a band is chosen by the litres sold,
  but the rate is still applied to the amount.

- `subsidyAmount` is what the state pays towards the sale: `subsidy.rate` is **a fixed amount
  for each litre** — 240 a litre on 40 litres is 9,600 — never a percentage. `subsidy.car` is
  the client's car that earned it.

A sale gets **one** discount — the best of those in force, never two added together. Which
one applies depends on the site, the client (a card or coupon sale) and the litres, so the
quote must be asked with the real quantity, after the pump stops.

**A subsidy needs an allowed car.** It is recorded only when the sale was for a client who is
flagged `subsidyAllowed`, driving one of their own cars that is **also** flagged
`subsidyAllowed` and **takes the product being pumped**, and a subsidy is in force for that
product at this site today. The car is recognised by the card at the pump, or by the plate
number recorded with the sale (compared on its letters and digits only, so `RAD 123 A` and
`rad123a` are one car). A walk-in with no client never earns one.

Only an `initiated` sale can be quoted (`409 TRANSACTION_NOT_OPEN`). Show the figures on the
screen and on the receipt; the server prices the sale again when it is confirmed, so the quote
is advice, never the record.

**2. `POST /mobile/transactions/:code/confirm`** closes the sale. In one database
transaction it takes the litres out of the tank, writes a `CuveTransaction` (sold/OUT),
records the payments and marks the sale `confirmed`. For a card sale it also charges `amount`
to the card's main card — **the full pump amount**, since a discount is recorded rather than
deducted (refused if the balance is short, unless the card type has `allowCredit`) and writes a `CardCopyTransaction` (PAYMENT/OUT). What the card paid is
recorded as the sale's payment too, against the company account of type `card` — this site's,
else the company's — with the card's number as its reference, so a card sale is never short on
the receipt or in a by-account total. One active account of that type must exist
(`422 CARD_ACCOUNT_MISSING`); coupon sales work the same way with a `coupon` account. Every sale is also recorded as
a `FuelSale` with its payments, as if entered on the web, sharing the same tank movement, so it
shows in the Fuel sales pages and report. If any check fails, nothing changes.

| Field | | |
|---|---|---|
| `phone`, `pin` | required | The attendant. Must be an active user at the site, **on the time table** for a shift running now, and on the pump rota for the sale's pump and nozzle — see "Who may confirm a sale" below. Becomes `doneBy`, and that site shift is recorded on the sale. |
| `quantity` | required | Litres, at most 2 decimals. |
| `unitPrice` | required | The price per litre. Must equal the price fixed when the sale started (`unitPrice` in the initiate response). |
| `amount` | required | What the pump display shows. May differ from `quantity` × `unitPrice` by at most the price of 0.01 litre (the pump's rounding). |
| `payments` | JSON array | `[{"accountId","amount","reference"?}]`. Required **without** a card, and the amounts must add up to **the pump's own amount** — a discount or a subsidy never changes what is due. Anything else is refused with `422 PAYMENTS_DO_NOT_MATCH`, whose `data` carries `grossAmount`, `discountAmount`, `amount`, `discount`, `subsidyAmount`, `subsidy` and `paidAmount`. **Not allowed with a card** (`422 PAYMENTS_NOT_FOR_CARD`): the card pays the whole sale, so taking payments as well would charge the client twice. |
| `referenceDoc.<n>` (file) | optional | PDF or picture for payment `n`. |
| `displayPicture` (file) | optional | Picture of the pump display. Required when the card type has `captureDisplay`. |
| `shiftId`, `comments`, `appVersion`, `printStatus` (`true`/`false`) | optional | `shiftId` may only name the shift the attendant is **working now** — the one the time table and the pump rota agree on, which is what the sale is filed under either way. Another shift at the site is refused with `422 SHIFT_NOT_YOURS`, one from elsewhere with `SHIFT_NOT_AT_SITE`, a retired one with `SHIFT_SWITCHED_OFF`. |

Limited to 20 a minute per device. A sale can only be confirmed once: a second confirm,
including one sent at the same moment, gets `409 TRANSACTION_ALREADY_CONFIRMED`.

**What the sale comes back as.** Every sale returned carries `grossAmount` (the pump),
`amount` (collected — the same figure), `discountAmount` and `discountRate` (the percentage),
and `subsidyAmount` and `subsidyRate` (the amount a litre). All four are **copied onto the
sale**, so editing or retiring a discount or a subsidy later never changes a sale already
recorded. A sale that earned neither has them all at `0`.

**Listing:** `GET /mobile/transactions?status=initiated|confirmed|cancelled` returns the site's
50 newest sales in that status, newest first; without `status`, the open (`initiated`) ones.
Each has the same full detail as a single sale: product, tank, pump, nozzle and its display,
site, the POS that recorded it, card, client (and `clientName` at the top level, `null` without a card), the attendant who confirmed it (`attendant`: `id`, `firstName`, `lastName`, `names`, and `attendantName` ready to print; `null` until confirmed), shift, payments with
their accounts, pictures and documents, and `expiresAt`. Overdue sales are cancelled before
listing, so the initiated list only holds sales that can still be confirmed.

**Also:** `GET /mobile/transactions/:code` reads a sale back, and
`POST /mobile/transactions/:code/cancel` with `reason` cancels a sale that is still
initiated. A cancelled sale cannot be confirmed (`409 TRANSACTION_CANCELLED`).
**Receipts:** reading a sale (`GET /mobile/transactions/:code`), confirming it and updating its
print status each return a `company` block for the receipt header and footer, kept on the web
under System Settings → Company Settings: `name`, `address`, `phone`, `email`, `taxId` (TIN),
`website`, `currency`, `logoUrl` (full URL) and `receiptFooter`. The sale itself carries the attendant who confirmed it as `attendantName`. Each is `null` when not set, and
`company` itself is `null` until the profile has been saved. Lists of sales do not carry it.

### Fuel sales paid with coupons — `/mobile/coupon-sales`

A coupon sale is a `GeneralTransaction` like any other, so it is read, listed and printed through
`/mobile/transactions` (`GET /mobile/transactions`, `GET /mobile/transactions/:code`,
`PATCH /mobile/transactions/:code/print-status`). Starting, confirming and cancelling it have routes
of their own. The coupons pay as much of the sale as they can and the client pays the rest in cash,
mobile money or anything else the site takes. The coupon part is recorded against the company
account of type `coupon` (this site's, else the shared one), which must exist and be active
(`COUPON_ACCOUNT_MISSING`); the rest is recorded against the accounts named, which may not be
coupon accounts. The client must have a PIN, set on the web (Clients → edit the client admin →
Organisation PIN).

**1. `GET /mobile/coupon-sales/clients?search=`** lists up to 50 active clients holding coupons they
can still spend, most first: `id`, `clientCode`, `name`, `phone`, `hasPin` (without a PIN the client
cannot pay with coupons), `spendableAmount`, `couponCount`. `search` matches name, code or phone.

**2. `POST /mobile/coupon-sales/clients/verify`** with `{"clientId", "pin"}` checks the client's PIN
and returns `{client, spendableAmount, couponCount}`. It never returns coupon codes: only the paper
pays. A wrong PIN, no PIN set and an inactive client all get `422 INVALID_CLIENT_PIN`. 20 a minute per device.

**3. `POST /mobile/coupon-sales`** (multipart, 20 a minute per device) starts the sale and fixes
everything about the fuel. Returns `201` with the sale, status `initiated`, `expiresAt: null`:
a coupon sale **never times out**, and the ordinary confirm refuses it (`409 COUPON_SALE`).

The fuel is already in the car by now — the amount is what the pump display shows — so a sale is
started **even when the client's coupons cannot pay all of it**. The answer carries `couponFunds`:
`spendableAmount` (what their coupons can pay), `couponCount`, and `dueFromClient` (what to collect
on top, `0` when the coupons cover it). Show that to the attendant before confirming.

**Discounts and subsidies.** The litres are already known here, so a coupon sale is **priced
as it starts**: there is no quote step. Send `amount` as the pump display shows it; the sale
comes back with `grossAmount`, `amount` (the same figure — what the coupons and any cash must
pay between them), `discountAmount`, `discountRate`, `subsidyAmount` and `subsidyRate`, and
`couponFunds.dueFromClient` is worked out against the pump's amount. **Both are recorded, not
deducted**, so neither reduces what the coupons have to cover. A client's own negotiated rate
applies here as it does to a card sale, and the subsidy needs the same allowed car — found by
the `platNumber` sent with the sale.

| Field | | |
|---|---|---|
| `clientId`, `clientPin` | required | The client, checked with their PIN again. |
| `itemId`, `cuveId`, `pumpId`, `nozzleId` | required | Checked as for a POS sale. |
| `quantity`, `unitPrice`, `amount` | required | As the pump shows them. `unitPrice` must be the price in force (`UNIT_PRICE_MISMATCH`, `data.unitPrice` gives it); `amount` must be within 0.01 litre's worth of quantity × price (`AMOUNT_MISMATCH`). |
| `displayPicture` (file) | **required** | Picture of the pump display (`DISPLAY_PICTURE_REQUIRED`). |
| `platePicture` (file) | optional | PNG, JPG or WEBP picture of the car's plate. Stored as `platePictureUrl`. |
| `platNumber`, `appVersion` | optional | |

**4. `POST /mobile/coupon-sales/:code/confirm`** (JSON or form data, 20 a minute per device) checks
only the coupons and the attendant, then records everything in one database transaction — or
nothing at all:

| Field | | |
|---|---|---|
| `clientId` | required | Must be the sale's client (`CLIENT_MISMATCH`). |
| `coupons` | required | Array (or JSON array in a form field) of scanned codes or QR tokens, in the order scanned, 1–50. Each must belong to that client (`COUPON_OTHER_CLIENT`). |
| `payments` | JSON array | `[{"accountId","amount","reference"?}]` — cash, mobile money and the like, for whatever the coupons do not cover. Omit it when the coupons pay the whole sale. A coupon account is refused here (`422 COUPON_ACCOUNT_IN_PAYMENTS`): the coupons are recorded against it already. |
| `referenceDoc.<n>` (file) | optional | PDF or picture for payment `n`, as for an ordinary sale. Send the request as form data to use it. |
| `phone`, `pin` | required | The attendant, on the time table for the shift running now and on the rota for the sale's pump and nozzle (as for confirm). Becomes `doneBy`. |
| `comments`, `appVersion`, `printStatus` | optional | |

The coupons pay in the order scanned, each as much as is still owed: all but the last are used
whole and the last keeps what it does not need (five 1,000 coupons on a 4,500 sale use four and
leave 500 on the fifth). A coupon that is not needed at all is refused (`COUPON_NOT_NEEDED`).

**The coupons and the payments must pay the sale exactly.** If the coupons fall short and no
payments were sent, it is refused with `422 COUPONS_SHORT`, whose `data.due` says how much to
collect — so the POS can ask for it and confirm again. If payments were sent but the total is
wrong, it is `422 PAYMENTS_DO_NOT_MATCH`, with the same `data` (`couponAmount`, `paidAmount`,
`amount`, `due`). Nothing is spent either way.

Then the coupon part is recorded on the coupon account and each payment on its own account, the
litres leave the tank (`CuveTransaction` sold/OUT), and a `FuelSale` is written for the web with
the same payments. The answer is the sale with `coupons` (each `code`, `amount` taken,
`remainingAmount`, `usage`), `payments`, `attendantName` and the `company` block for the receipt.

**`POST /mobile/coupon-sales/:code/cancel`** with `reason` cancels a coupon sale not yet confirmed;
no coupon was spent, so nothing is given back.

| Status | Code | Meaning |
|---|---|---|
| 422 | `INVALID_CLIENT_PIN` | Wrong client PIN, no PIN set, or client inactive. |
| 422 | `COUPON_ACCOUNT_MISSING` | No active company account of type `coupon`. |
| 422 | `COUPONS_SHORT` | The coupons do not pay the whole sale and nothing was sent for the rest; `data.due` is what to collect. |
| 422 | `PAYMENTS_DO_NOT_MATCH` | The coupons and the payments do not add up to the sale; `data.due` is what is still owed. |
| 422 | `COUPON_ACCOUNT_IN_PAYMENTS` | A payment names a coupon account, which the coupons are recorded against already. |
| 422 | `PAYMENT_REFERENCE_REQUIRED`, `ACCOUNT_INACTIVE`, `ACCOUNT_NOT_AT_SITE`, `DUPLICATE_PAYMENT_ACCOUNT` | The payments collected for the rest, as for an ordinary sale. |
| 422 | `CLIENT_MISMATCH`, `COUPON_OTHER_CLIENT` | The sale or a coupon belongs to another client. |
| 404 | `COUPON_NOT_FOUND` | No coupon matches a scan; `data.coupon` names it. |
| 422 | `COUPON_USED`, `COUPON_EXPIRED`, `COUPON_CANCELLED`, `DUPLICATE_COUPON` | A scanned coupon cannot pay. |
| 422 | `COUPON_NOT_NEEDED` | The sale was already covered before this coupon; nothing was spent. |
| 409 | `COUPON_IN_USE` | Another pump spent the coupon at the same moment; scan it again. |
| 409 | `NOT_A_COUPON_SALE` / `COUPON_SALE` | A coupon route used for an ordinary sale, or the reverse. |
| 422 | `INVALID_ATTENDANT`, `ATTENDANT_NOT_ON_SHIFT`, `ATTENDANT_NOT_ON_PUMP`, `ATTENDANT_NOT_ON_NOZZLE`, `INSUFFICIENT_CUVE_STOCK`, `UNIT_PRICE_MISMATCH`, `AMOUNT_MISMATCH`, `PRICE_NOT_SET` | As for POS sales. |
| 409 | `TRANSACTION_ALREADY_CONFIRMED`, `TRANSACTION_CANCELLED` | The sale is no longer open. |

### Who may confirm a sale

Two records answer two different questions, and a sale checks both.

**The time table (`TblTimeTable`) says when.** It rosters people onto a site
shift for a **date**, and carries their attendance (`status`: 0 planned, 1
present, 2 absent). Confirming looks for a row putting that attendant on a
shift at this site whose hours include the time now in Rwanda, on the date that
shift belongs to, and not marked absent. A shift running past midnight belongs
to the date it started on, so in its small hours yesterday's roster applies —
and that date is the working day the sale counts towards (the `dateOn` of the
`FuelSale` written alongside it).

**The pump rota (`TblPumpAttendant`) says where.** One row per attendant, pump
and shift, holding the nozzles they handle. It has **no weekday**: which days
someone works is the time table's job. Because of that, several attendants may
hold the same nozzle in one shift — the time table decides which of them is
there on a given date.

So a site must keep its time table filled in: an attendant with no row for the
shift running now cannot confirm a sale (`422 ATTENDANT_NOT_ON_SHIFT`), even
with a rota entry for the pump. Rostering is on the web, under Shifts → Time
table, which can copy a week onto the next.

Confirming a sale therefore asks three questions, in this order, and the sale
is refused at the first "no":

1. Does the time table put this attendant on a shift **running now** at this
   site, not marked absent? (`ATTENDANT_NOT_ON_SHIFT`)
2. Does the rota put them on **the pump the sale was started on**, in that same
   shift? (`ATTENDANT_NOT_ON_PUMP`)
3. Is **the nozzle the sale was started on** one of theirs on that pump?
   (`ATTENDANT_NOT_ON_NOZZLE`)

The pump and the nozzle are read from the sale itself, written when it was
initiated, so a confirm cannot move a sale onto equipment the attendant does
hold. The shift those checks agree on is the one the sale — and the fuel sale
mirrored for the web — is recorded under.

`PATCH /mobile/transactions/:code/print-status` records whether the receipt of a confirmed sale
was printed: `printStatus` (`true`/`false`, as form data or JSON), `true` when left out. It returns
the sale; sending the same value again is harmless. A sale that is not confirmed gets
`409 TRANSACTION_NOT_CONFIRMED`.

| Status | Code | Meaning |
|---|---|---|
| 415 | `MULTIPART_REQUIRED` | The request was not sent as form data. |
| 400 | `UNSUPPORTED_FILE` / `VALIDATION_ERROR` | Wrong file type, or a field is missing or malformed. |
| 404 | `RESOURCE_NOT_FOUND` | Unknown nozzle, card or transaction code at this site. |
| 422 | `INVALID_ATTENDANT` | Wrong phone number or PIN (one answer for both). |
| 422 | `ATTENDANT_NOT_ON_SHIFT` | Confirming: the time table does not put the attendant on any shift running now at this site, or it marks them absent. |
| 422 | `ATTENDANT_NOT_ON_PUMP`, `ATTENDANT_NOT_ON_NOZZLE` | Confirming: the attendant is on the shift but not on the rota for the sale's pump, or its nozzle is not one of theirs. The pump and nozzle are the **sale's own**, as it was started — the confirm cannot name others. |
| 422 | `SHIFT_NOT_YOURS` | Confirming: the `shiftId` sent names a shift the attendant is not working now. The sale is filed under the shift the time table and the rota agree on. |
| 422 | `NOZZLE_NOT_ON_PUMP`, `NOZZLE_CUVE_MISMATCH`, `ITEM_CUVE_MISMATCH`, `*_INACTIVE`, `PRICE_NOT_SET` | The sale does not match the site's equipment. |
| 422 | `PLATE_NUMBER_REQUIRED`, `PLATE_PICTURE_REQUIRED`, `DISPLAY_PICTURE_REQUIRED` | The card type's rules. |
| 422 | `CAR_NOT_ASSIGNED_TO_CARD` | The plate is not one of the active cars assigned to the card. |
| 422 | `CAR_ITEM_MISMATCH` | That car runs on another product than `itemId`; `data.car.item` says which. |
| 422 | `PAYMENTS_REQUIRED`, `PAYMENTS_DO_NOT_MATCH`, `PAYMENT_REFERENCE_REQUIRED`, `ACCOUNT_*` | Payments. |
| 422 | `PAYMENTS_NOT_FOR_CARD` | The sale is paid with the client's card, so it takes no payments. |
| 422 | `CARD_ACCOUNT_MISSING` | The company has no active account of type `card` for the card's payment to be recorded against. |
| 422 | `INSUFFICIENT_CUVE_STOCK` | The tank holds less than the quantity. |
| 422 | `UNIT_PRICE_MISMATCH` | `unitPrice` is not the sale's price; `data.unitPrice` gives it. |
| 422 | `AMOUNT_MISMATCH` | `amount` is too far from `quantity` × `unitPrice`; `data.expectedAmount` gives the exact product. |
| 422 | `INSUFFICIENT_CARD_BALANCE` | The card's main card cannot pay and its type does not allow credit: no balance at all when starting, less than `amount` when confirming (`data.balance`). |
| 409 | `CARD_BUSY` | The card's main card is in an open sale; `data.site` says where. |
| 422 | `CARD_NOT_AVAILABLE` | The card's state is neither free nor busy. |
| 409 | `TRANSACTION_EXPIRED` | The sale was not confirmed within 10 minutes and has been cancelled. |
| 409 | `TRANSACTION_ALREADY_CONFIRMED`, `TRANSACTION_CANCELLED`, `TRANSACTION_NOT_OPEN` | The sale is no longer open. |
