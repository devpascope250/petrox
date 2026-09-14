BASE URL: https://petrox.quicko.rw/api/v1

### for user 
GET:   /users
POST: /users
GET: /users/:id

## for Authentications

POST: /auth/login 
{ accessToken: string, refreshToken: string, expiresAt:Date, user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
}, permissions: string[] }
POST: /auth/pin-login
POST: /auth/refresh
POST: /auth/logout
POST: /auth/password-reset/request"
POST: /auth/password-reset/confirm"

### for sidebar
GET: /modules/sidebar

## Coupon plans and client coupons

Base paths: `/api/v1/coupon-plans` and `/api/v1/client-coupons`.
Both require bearer authentication and the matching `coupon.plans.*` or
`client.coupons.*` permission. Actions are `read`, `create`, `edit`,
`delete`; `manage` permits every action.

| Method | Path relative to base | Operation |
| --- | --- | --- |
| GET | / | Paginated list |
| GET | /:id | Find by UUID |
| POST | / | Create (201) |
| PUT | /:id | Update supplied fields |
| PATCH | /:id/status | Set status using `{"status":"..."}` |
| DELETE | /:id | Delete; returns `{"success":true,"data":{"id":"..."}}` |

Create plan:
```json
{"name":"Standard","number":10,"amount":"25000.00","status":"active"}
```
Plan name, number and amount are required. Number is a positive 32-bit integer.
Status defaults to `active`; valid values are `active` and `inactive`.
The number field is stored as supplied; creating a plan does not generate coupons.

Create client coupon:
```json
{"couponPlanId":"<plan UUID>","clientId":"<client UUID>","amount":"25000.00"}
```
The three fields above are required. Optional fields are `code`, `token`,
`export` (boolean), `generatedAt`, `printedAt`, `scannedAt`, and `status`.
Omitted code and token are generated using cryptographic randomness.
Codes are unique. Amount is independent of the plan amount.
Generated time defaults to now; printed/scanned times can be null.
Dates must be ISO 8601 timestamps with a timezone.
Statuses: `available` (default), `printed`, `scanned`, `expired`, `used`,
`called`, `cancelled`. These CRUD operations store status and timestamps as
supplied; they do not perform printing, scanning, redemption, or automatic expiry.
Tokens are included in responses, so grant read permissions only to appropriate roles.

Amounts must be positive with at most 16 integer digits and 2 decimal places.
Use decimal strings to preserve precision. Updates require at least one field;
unknown fields are rejected. IDs and creation/update timestamps are server-managed.

Lists accept `page` (default 1) and `pageSize` (default 20, maximum 100).
Plan filters: `status`, `search` (name substring).
Coupon filters: `clientId`, `couponPlanId`, `status`, `code` (exact),
`export=true|false`. Results contain `data.items` and `data.pagination`.
Plan reads include a coupon count; coupon reads include their plan and client.

Invalid inputs return 400, missing records/relations 404, duplicate codes 409.
Deleting a plan with associated coupons returns 409; remove or reassign them first.
Database foreign keys also protect against concurrent relation changes.

Deployment: these models were already present in schema.prisma and this repository
has no migration history. Apply the schema through your normal database deployment
workflow before using these endpoints, then run `pnpm prisma:generate` and
`pnpm prisma:seed` to synchronize the permission catalogue. Grant the new
permissions to the appropriate roles. No database schema or seed was applied
as part of this implementation.

## Current cuve stock and transaction reports

Both routes require authentication and `cuve.read` or `cuve.manage`. Super
administrators select a site for the stock list. Site managers are always restricted to
their assigned site, including when requesting a cuve by ID. Other positions
cannot access these reports.

### GET /api/v1/cuves/stocks

Query parameter: `siteId` (UUID), required for super administrators; omission
returns HTTP 400 (`SITE_ID_REQUIRED`). Site managers may omit it: their assigned
site is always used and overrides a supplied `siteId`. There is no item filter;
items are obtained from the site's cuves. Includes active and inactive cuves so
existing balances remain visible.

Returns `{ success: true, data: { cuves, summary } }`:

- `cuves`: each cuve's `id`, `name`, `itemId`, `siteId`, `item` (including
  `baseUnit`), `site`, `balance`, `minimum`, `maximum`, `deadStock`, and `status`.
- `summary`: `cuveCount` and `items`, with each item's details, summed `balance`,
  and `cuveCount` across all matching cuves. Quantities are JSON numbers.

Use the cuve `id` from the selected row to load its transaction report.

### GET /api/v1/cuves/:id/transactions

Example: `/api/v1/cuves/<cuve-id>/transactions?startDate=2026-09-01&endDate=2026-09-10&page=1&pageSize=20`

Optional query parameters:

- `startDate`, `endDate`: ISO calendar dates (`YYYY-MM-DD`) or ISO timestamps
  with a timezone. Date-only values include the complete UTC day. Both bounds
  are inclusive; either may be omitted. Reversed ranges are rejected.
- `page`: defaults to 1; `pageSize`: defaults to 20, maximum 100.

Returns `{ success: true, data: { cuve, items, pagination, summary } }`.
`cuve` contains the same stock details as the list. `items` contains transactions
ordered newest first, with `id`, `cuveId`, `quantity`, `type`, `direction`, `note`,
`createdAt`, and `updatedAt`. `pagination` contains `page`, `pageSize`, `total`,
`totalPages`, `hasNextPage`, and `hasPreviousPage`.

`summary` covers **all transactions in the selected period**, not just the page:
`startDate`, `endDate`, `transactionCount`, `totalIn`, `totalOut`, `netMovement`,
`openingBalance`, `closingBalance`, and `currentBalance`. Net movement is IN minus
OUT. Closing balance is current cuve balance minus movements after the selected
end; opening balance is closing balance minus selected net movement. With no
end date, closing balance equals current balance. With no start date, opening
balance represents stock before the earliest recorded transaction.

Balances use `TblCuve.balance`; movements use `CuveTransaction`. Historical
balances require stock movements and current balance to be maintained together.
These routes do not backfill receipts that predate the transaction ledger.
