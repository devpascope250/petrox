# Wallet operations

- [x] Buy coupons from an active coupon plan using the client's wallet balance.
- [x] Transfer wallet funds to a card assigned to the same client and create a card transaction.
- [x] Register both operations under the client wallet routes.

Both endpoints require authentication and `client.wallets.edit`. Client users can only use their own wallets. The wallet must be active and have enough balance. Each operation runs in one serializable database transaction: a failure rolls back all balance and record changes.

## Buy coupons

`POST /api/v1/client-wallets/:id/buy-coupons`

```json
{
  "couponPlanId": "7de52860-00c0-4907-a665-d210eeeb8c2b",
  "quantity": 2
}
```

`quantity` defaults to 1 and must be an integer from 1 to 100. Each coupon costs the active plan's stored `amount`; the frontend cannot supply the price. The purchase generates that many `available` client coupons with unique codes and random tokens, assigned to the wallet's client. The plan's `number` is not treated as stock or a purchase quantity.

The response contains `wallet`, total `amount`, `coupons`, and `transactions`. Each coupon has a corresponding `PAYMENT` / `OUT` wallet transaction whose `referenceId` is the coupon ID.

## Transfer to a card

`POST /api/v1/client-wallets/:id/transfer-to-card`

```json
{
  "cardId": "5",
  "amount": "2500.00"
}
```

Send the physical card ID as a string. The card must have an active `CardCopy` assignment to the wallet's client, either as the main card or the copy card, and have `state: 1`. The selected card's balance is credited. Amount must be positive with at most two decimal places, and the resulting balance must fit the database's monetary range.

The response contains `wallet`, `transaction`, `card`, and `cardTransaction`. The wallet records `TRANSFER` / `OUT`; the card assignment records `TRANSFER` / `IN` and the authenticated user's ID. The wallet transaction's `referenceId` identifies the card transaction. BigInt IDs are returned as strings.

## Existing movements

`POST /api/v1/client-wallets/:id/movements` continues to support incoming movements, including deposits with supporting documents. Generic outgoing `PAYMENT`, `WITHDRAWAL`, and `TRANSFER` requests are rejected with `WALLET_OPERATION_REQUIRED`; use the two operations above to debit a wallet.

No database migration is needed for these operations. They use the existing wallet, coupon, card, and transaction models.
