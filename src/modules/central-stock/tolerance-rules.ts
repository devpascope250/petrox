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
