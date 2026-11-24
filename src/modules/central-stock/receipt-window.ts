import type { Prisma } from "../../../prisma/generated/prisma/client.js";

/**
 * The date window a report should put over central stock receipts.
 *
 * **`offloadingDate`, falling back to `createdAt`** — the day the load was
 * discharged, not the day somebody typed the receipt.
 *
 * The two are routinely weeks apart. A receipt is keyed in when the paperwork
 * reaches the office, and a backlog entered this month describes fuel that
 * moved months ago; `createdAt` is `@default(now())` and nothing can set it, so
 * windowing on it files every one of those loads under the day the clerk sat
 * down. A report asked for October then answers about October's typing rather
 * than October's fuel, and the figures cannot be reconciled against anything
 * physical.
 *
 * The fallback is what keeps the change safe for what is already on record:
 * receipts written before `offloadingDate` existed carry NULL and are still
 * placed by `createdAt`, exactly where they are placed today. Only a receipt
 * that states its own discharge date moves — to where it belongs.
 *
 * Returns `{}` when no window is asked for, so it can be spread
 * unconditionally.
 *
 * ⚠️ It contributes an `OR`, which combines with the rest of a `where` by AND.
 * Spread it into a `where` that has an `OR` of its own and one will overwrite
 * the other — nest them under `AND` in that case.
 */
export function receiptWindow(
  startDate?: Date,
  endDate?: Date,
): Prisma.CentralStockWhereInput {
  if (!startDate && !endDate) return {};
  const window = { gte: startDate, lte: endDate };
  return {
    OR: [
      { offloadingDate: window },
      // No discharge date recorded: judged by when it was keyed in, which is
      // the best this receipt can say.
      { offloadingDate: null, createdAt: window },
    ],
  };
}
