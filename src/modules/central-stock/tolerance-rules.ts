import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Two decimals: what the quantity and rate columns hold. */
const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);
const ZERO = new Prisma.Decimal(0);

/**
 * What a trip lost or gained between the border and the depot.
 *
 * Both figures are **at 20 °C**, which is the only way to compare them: fuel
 * expands and contracts with temperature, so an ambient litre at the border is
 * not an ambient litre at the depot. The T1 validation says what was cleared;
 * the central stock receipt says what was taken in.
 *
 *     difference = t1 − received     positive is a loss, negative a gain
 *     rate       = |difference| ÷ t1 × 100
 *
 * The product's `ItemToleranceRate.maxRate` is **a percentage of the trip**, so
 * what a load is allowed to lose grows with the load: 1% of 40,000 litres is
 * 400. A trip inside it is ordinary evaporation and measurement error; one
 * outside it is worth asking the transporter about, which is the whole point
 * of recording it against them.
 */
export interface Tolerance {
  /** `t1 − received`: positive is short, negative is over. */
  difference: Prisma.Decimal;
  /** The short, or zero. What the receipt stores as `lossQty`. */
  lossQty: Prisma.Decimal;
  /** The excess, or zero. What the receipt stores as `gainQty`. */
  gainQty: Prisma.Decimal;
  /** The difference as a percentage of what was cleared. */
  rate: Prisma.Decimal;
  /**
   * The percentage the product is allowed, as it stood when the load was
   * received — `null` when the product has no rate set. Snapshotted, so a
   * later change to the rate cannot rewrite what a past trip was judged by.
   */
  allowedRate: Prisma.Decimal | null;
  /** That percentage in litres of this trip, for a report that shows both. */
  allowedQuantity: Prisma.Decimal | null;
  /**
   * What the transporter is answerable for: the short **beyond** the
   * allowance. 2,000 cleared at 0.3% allows 6; deliver 1,600 and the 400
   * short is 394 past what was allowed, and that 394 is theirs.
   *
   * Zero when the trip is inside its allowance, and zero for a gain — a load
   * that arrives over is not something the transporter owes. `null` when the
   * product carries no rate, since nothing can be charged against an
   * allowance nobody has set.
   */
  chargeableQty: Prisma.Decimal | null;
  /**
   * Whether the difference is inside the allowance. A product with no rate
   * set is not "within" anything — it is unjudged, and the report says so.
   */
  withinTolerance: boolean | null;
}

/** The percentage a product is allowed to lose, or `null` when none is set. */
export async function allowedToleranceRate(db: Db, itemId: string) {
  const rate = await db.itemToleranceRate.findFirst({
    where: { itemId, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { maxRate: true },
  });
  return rate?.maxRate ?? null;
}

/**
 * The tolerance of one trip. Pure arithmetic on the three figures, so the same
 * answer comes out at the receipt, in the report and in the recompute script —
 * there is no second opinion anywhere.
 */
export function toleranceFor(input: {
  t1Quantity: Prisma.Decimal | number | string;
  receivedQuantity: Prisma.Decimal | number | string;
  allowedRate: Prisma.Decimal | number | string | null;
}): Tolerance {
  const t1 = money(input.t1Quantity);
  const received = money(input.receivedQuantity);
  const difference = money(t1.minus(received));
  const allowedRate = input.allowedRate === null ? null : money(input.allowedRate);
  // A trip with nothing cleared has no percentage to speak of: dividing by it
  // would be a quiet infinity rather than an honest zero.
  const rate = t1.isZero() ? ZERO : money(difference.abs().dividedBy(t1).times(100));
  const allowedQuantity = allowedRate === null ? null : money(t1.times(allowedRate).dividedBy(100));
  const lossQty = difference.greaterThan(0) ? difference : ZERO;
  return {
    difference,
    lossQty,
    gainQty: difference.lessThan(0) ? difference.abs() : ZERO,
    chargeableQty: allowedQuantity === null
      ? null
      : Prisma.Decimal.max(money(lossQty.minus(allowedQuantity)), ZERO),
    rate,
    allowedRate,
    allowedQuantity,
    // A gain is measured against the same allowance: 500 litres more than was
    // cleared is as much a question as 500 fewer.
    withinTolerance: allowedQuantity === null ? null : difference.abs().lessThanOrEqualTo(allowedQuantity),
  };
}

/**
 * What a receipt was recorded as taking in, reconstructed from the snapshot it
 * keeps — **not** from its live `quantityAt20C`.
 *
 * The two are not the same number. A reconciliation decrements
 * `CentralStock.quantityAt20C`, because that column doubles as the receipt's
 * running balance: 30,000 taken in and 2,000 later reconciled out reads as
 * 28,000. Grading a trip against the live column therefore re-judges it every
 * time the depot's balance moves, and a transporter whose load was exact would
 * be shown — and could be invoiced — as 2,000 short for a discrepancy found
 * months later and nothing to do with them.
 *
 * `lossQty` and `gainQty` are written once, when the load is taken in, and
 * never touched again. Since `difference = t1 - received` and the two columns
 * are its positive and negative halves, the figure as it stood that day comes
 * straight back out:
 *
 *     received = t1 - (lossQty - gainQty)
 *
 * The same reasoning as the `toleranceRate` snapshot beside them: a trip
 * already made is not re-judged by anything that happened afterwards.
 *
 * With no snapshot — a receipt written before those columns existed — it falls
 * back to the receipt's **`received` movements**, which reconciliation never
 * touches: it writes its own rows beside them. Only with neither does it read
 * the live column, and that reading is wrong the moment the receipt is
 * reconciled: a batch reconciled out in full would report its whole load as
 * lost, charging a −100% shortfall to whoever drove it. A report that dropped
 * such receipts would still be worse than one that grades them as they stand,
 * so the column remains the last resort rather than no answer at all.
 */
/**
 * What a receipt's `received` movements add up to. The movements are the one
 * immutable record of what arrived: a reconciliation writes a
 * `reconcilliationIn`/`Out` row of its own rather than changing these.
 */
export function sumReceivedMovements(
  transactions: Array<{ quantity: Prisma.Decimal | number | string; type: string }>,
) {
  return transactions.reduce(
    (total, transaction) =>
      transaction.type === "received" ? total.plus(money(transaction.quantity)) : total,
    money(0),
  );
}

export function receivedAsRecorded(input: {
  t1Quantity: Prisma.Decimal | number | string | null;
  lossQty: Prisma.Decimal | number | string | null;
  gainQty: Prisma.Decimal | number | string | null;
  /** The live column: the last resort, and only when it is all there is. */
  quantityAt20C: Prisma.Decimal | number | string;
  /**
   * What the receipt's `received` movements add up to, for a receipt with no
   * snapshot. Immutable, so it beats the column — pass it wherever the
   * movements are already to hand.
   */
  receivedMovements?: Prisma.Decimal | number | string | null;
}): Prisma.Decimal {
  // Both null means "never recorded". Both zero is a real snapshot — a trip
  // that arrived exactly — so the test is nullness, never truthiness.
  if (input.lossQty === null && input.gainQty === null) {
    const moved = input.receivedMovements;
    // Zero movements is not an answer: a receipt whose `received` row cannot
    // be found is better graded on its column than on nothing.
    if (moved !== null && moved !== undefined && money(moved).greaterThan(0)) return money(moved);
    return money(input.quantityAt20C);
  }
  const t1 = money(input.t1Quantity ?? 0);
  const loss = money(input.lossQty ?? 0);
  const gain = money(input.gainQty ?? 0);
  return money(t1.minus(loss.minus(gain)));
}

/** The columns a central stock receipt carries, from what the trip came to. */
export function toleranceColumns(tolerance: Tolerance) {
  return {
    lossQty: tolerance.lossQty,
    gainQty: tolerance.gainQty,
    /** The allowance in force that day, not the difference: that is `lossQty`/`gainQty`. */
    toleranceRate: tolerance.allowedRate,
  };
}

/** Everything a receipt needs to be judged: the trip's own two figures and the allowance. */
export async function toleranceForReceipt(db: Db, input: { t1ValidationId: string; itemId: string; receivedQuantity: Prisma.Decimal | number | string }) {
  const [validation, allowedRate] = await Promise.all([
    db.t1Validation.findUnique({ where: { id: input.t1ValidationId }, select: { quantityAt20C: true } }),
    allowedToleranceRate(db, input.itemId),
  ]);
  return toleranceFor({
    t1Quantity: validation?.quantityAt20C ?? 0,
    receivedQuantity: input.receivedQuantity,
    allowedRate,
  });
}
