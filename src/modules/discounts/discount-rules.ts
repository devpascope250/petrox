import { Prisma, type DiscountType, type PrismaClient } from "../../../prisma/generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Two decimals: what the money columns hold, so nothing is rounded away silently. */
const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);

/**
 * A discount **rate is a percentage of what the sale is worth** — for both
 * kinds: a `fixed` discount's `value` and a `ranging` tier's `rate`. The
 * sale's own discount is therefore `grossAmount × rate ÷ 100`, rounded to the
 * two decimals the money columns hold:
 *
 *     11.34 litres × 1,764 = 20,003.76 gross
 *     20,003.76 × 10% ....... 2,000.38 off  (2,000.376 rounded)
 *     ....................... 18,003.38 to collect
 *
 * The litres only decide **which** tier a `ranging` discount gives; they are
 * not multiplied by the rate.
 */
export type SaleDiscount = {
  discountId: string;
  type: DiscountType;
  /** The percentage off, as it stood when the sale was priced. */
  rate: Prisma.Decimal;
  /** `grossAmount × rate ÷ 100`, never more than the sale itself. */
  amount: Prisma.Decimal;
  /** The volume tier that gave it, for a `ranging` discount. */
  tier: { id: string; from: Prisma.Decimal; to: Prisma.Decimal } | null;
};

/** What a sale is worth before and after a discount, and the discount itself. */
export type DiscountedSale = {
  grossAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  /** What the customer owes: gross less the discount, never below zero. */
  amount: Prisma.Decimal;
  discount: SaleDiscount | null;
};

const candidateSelect = {
  id: true, type: true, value: true, clientId: true, siteId: true, createdAt: true,
} satisfies Prisma.DiscountSelect;

/**
 * The discounts in force for a sale: active, within their validity dates, at
 * this site or company-wide (`siteId` empty), and for this client or for
 * everyone (`clientId` empty). A sale with no client — a walk-in paying cash
 * at the pump — never picks up a discount written for one.
 *
 * A `ranging` discount brings its tiers for this site, active ones only.
 */
export async function discountsInForce(db: Db, where: { siteId: string; clientId?: string | null; at?: Date }) {
  const now = where.at ?? new Date();
  return db.discount.findMany({
    where: {
      status: "active",
      validFrom: { lte: now },
      validTo: { gte: now },
      AND: [
        { OR: [{ siteId: null }, { siteId: where.siteId }] },
        { OR: [{ clientId: null }, ...(where.clientId ? [{ clientId: where.clientId }] : [])] },
      ],
    },
    select: {
      ...candidateSelect,
      rangingDiscounts: {
        where: { status: "active", siteId: where.siteId },
        select: { id: true, from: true, to: true, rate: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

type Candidate = Awaited<ReturnType<typeof discountsInForce>>[number];

/**
 * The percentage one discount gives on this quantity: a `fixed` discount's own
 * value, or the rate of the volume tier the quantity falls in. `null` when a
 * ranging discount has no tier for this volume.
 *
 * A tier runs from `from` to `to` **inclusive at both ends**, so no volume
 * falls between two bands. Bands are written adjacent (0–100, then 100–200),
 * which leaves their shared bound in both; the higher band takes it — buying
 * exactly 100 litres earns the 100-and-over rate.
 */
function rateOf(discount: Candidate, quantity: Prisma.Decimal) {
  if (discount.type === "fixed") return { rate: discount.value, tier: null };
  const tiers = discount.rangingDiscounts
    .filter((range) => quantity.greaterThanOrEqualTo(range.from) && quantity.lessThanOrEqualTo(range.to))
    .sort((left, right) => right.from.comparedTo(left.from));
  const tier = tiers[0];
  return tier ? { rate: tier.rate, tier: { id: tier.id, from: tier.from, to: tier.to } } : null;
}

/**
 * The one discount a sale gets, out of everything in force for it: **the best
 * for the customer, never several added together**. A client's own negotiated
 * rate and a volume promotion open to everyone can both qualify, and stacking
 * them would give away a discount nobody agreed to; the larger one wins, and
 * a client's own rate wins a tie.
 */
export function bestDiscount(discounts: Candidate[], quantity: Prisma.Decimal, grossAmount: Prisma.Decimal): SaleDiscount | null {
  let best: SaleDiscount | null = null;
  for (const discount of discounts) {
    const found = rateOf(discount, quantity);
    if (!found || found.rate.lessThanOrEqualTo(0)) continue;
    // A share of the sale, and never more than the whole of it: a rate written
    // above 100% would otherwise hand money back.
    const amount = Prisma.Decimal.min(money(grossAmount.times(found.rate).dividedBy(100)), grossAmount);
    if (amount.lessThanOrEqualTo(0)) continue;
    const better = !best
      || amount.greaterThan(best.amount)
      || (amount.equals(best.amount) && discount.clientId !== null && best.type !== "fixed");
    if (better) best = { discountId: discount.id, type: discount.type, rate: found.rate, amount, tier: found.tier };
  }
  return best;
}

/**
 * What a sale comes to once any discount in force is applied: the gross the
 * pump shows (`quantity × unitPrice`), what a discount takes off it, and what
 * is left to collect.
 *
 * The figures are returned to be **copied onto the sale** — `discountRate` and
 * `discountAmount` — so editing or retiring a discount later cannot rewrite
 * what a sale was charged.
 */
export async function priceWithDiscount(db: Db, input: {
  siteId: string;
  clientId?: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  at?: Date;
}): Promise<DiscountedSale> {
  const grossAmount = money(input.quantity.times(input.unitPrice));
  const discount = bestDiscount(await discountsInForce(db, input), input.quantity, grossAmount);
  const discountAmount = discount?.amount ?? new Prisma.Decimal(0);
  return { grossAmount, discountAmount, amount: money(grossAmount.minus(discountAmount)), discount };
}

/** The discount columns a sale carries, from what `priceWithDiscount` worked out. */
export function discountColumns(priced: DiscountedSale) {
  return {
    discountId: priced.discount?.discountId ?? null,
    discountRate: money(priced.discount?.rate ?? 0),
    discountAmount: money(priced.discountAmount),
  };
}

/** A discount as a POS or a screen reads it: plain numbers, with the tier that gave it. */
export function presentDiscount(priced: DiscountedSale) {
  return {
    grossAmount: Number(priced.grossAmount),
    discountAmount: Number(priced.discountAmount),
    amount: Number(priced.amount),
    discount: priced.discount && {
      id: priced.discount.discountId,
      type: priced.discount.type,
      rate: Number(priced.discount.rate),
      amount: Number(priced.discount.amount),
      tier: priced.discount.tier && {
        id: priced.discount.tier.id, from: Number(priced.discount.tier.from), to: Number(priced.discount.tier.to),
      },
    },
  };
}
