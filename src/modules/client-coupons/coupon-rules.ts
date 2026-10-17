import { Prisma, type ClientCouponUsage, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { AppError, BusinessError } from "../../utils/errors.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** When a coupon issued now stops being valid: `validityDays` after issue, or never. */
export function couponExpiry(validityDays: number | null | undefined, issuedAt = new Date()) {
  return validityDays ? new Date(issuedAt.getTime() + validityDays * 24 * 60 * 60_000) : null;
}

/** How much of a coupon is spent, from what is left of it. */
export function usageFor(remaining: Prisma.Decimal, amount: Prisma.Decimal): ClientCouponUsage {
  if (remaining.lessThanOrEqualTo(0)) return "used";
  return remaining.lessThan(amount) ? "partiallyUsed" : "unused";
}

/**
 * Marks coupons whose time ran out with value still on them as expired. Run
 * before coupons are listed or spent, so an expired one is never offered.
 */
export function expireCoupons(db: Db, now = new Date()) {
  return db.clientCoupon.updateMany({
    where: { usage: { in: ["unused", "partiallyUsed"] }, expiresAt: { lte: now } },
    data: { usage: "expired" },
  });
}

/** A scanned coupon: its code as printed, or the token its QR carries. */
const couponKey = (scan: string) => scan.trim();

/**
 * Spends the coupons scanned at the pump on a sale, in the order scanned:
 * each pays as much as is still owed, so all but the last are used whole and
 * the last may keep what it does not need. A coupon that is not needed at all
 * is refused, so nothing is spent by mistake.
 *
 * Each coupon is taken with a conditional update on the amount read, so two
 * pumps scanning the same paper at once cannot both spend it. Returns what the
 * coupons covered; the caller collects the rest by card or payments.
 */
export async function redeemCoupons(tx: Prisma.TransactionClient, input: {
  scans: string[];
  saleAmount: Prisma.Decimal;
  generalTransactionId: string;
  siteId: string;
  /** When set, every coupon must belong to this client. */
  clientId?: string;
  redeemedBy: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const scans = input.scans.map(couponKey).filter(Boolean);
  if (scans.length === 0) return { covered: new Prisma.Decimal(0), redemptions: [] };

  await expireCoupons(tx, now);
  const coupons = await tx.clientCoupon.findMany({
    where: { OR: [{ code: { in: scans.map((scan) => scan.toUpperCase()) } }, { token: { in: scans } }] },
    select: { id: true, code: true, token: true, clientId: true, amount: true, remainingAmount: true, status: true, usage: true, expiresAt: true },
  });
  const find = (scan: string) => coupons.find((coupon) => coupon.code === scan.toUpperCase() || coupon.token === scan);

  let owed = input.saleAmount;
  const seen = new Set<string>();
  const redemptions: Array<{ code: string; amount: Prisma.Decimal; remainingAmount: Prisma.Decimal }> = [];
  for (const scan of scans) {
    const coupon = find(scan);
    if (!coupon) throw new BusinessError("COUPON_NOT_FOUND", `No coupon matches ${scan}`, 404, { coupon: scan });
    if (seen.has(coupon.id)) throw new BusinessError("DUPLICATE_COUPON", `Coupon ${coupon.code} was scanned twice`, 422, { coupon: coupon.code });
    seen.add(coupon.id);
    if (input.clientId && coupon.clientId !== input.clientId) {
      throw new BusinessError("COUPON_OTHER_CLIENT", `Coupon ${coupon.code} belongs to another client`, 422, { coupon: coupon.code });
    }
    if (coupon.status === "cancelled") throw new BusinessError("COUPON_CANCELLED", `Coupon ${coupon.code} was cancelled`, 422, { coupon: coupon.code });
    if (coupon.usage === "expired") throw new BusinessError("COUPON_EXPIRED", `Coupon ${coupon.code} has expired`, 422, { coupon: coupon.code });
    if (coupon.usage === "used" || coupon.remainingAmount.lessThanOrEqualTo(0)) {
      throw new BusinessError("COUPON_USED", `Coupon ${coupon.code} is already used`, 422, { coupon: coupon.code });
    }
    if (owed.lessThanOrEqualTo(0)) {
      throw new BusinessError("COUPON_NOT_NEEDED",
        `The sale is already covered: coupon ${coupon.code} is not needed and was not spent`, 422, { coupon: coupon.code });
    }

    const take = Prisma.Decimal.min(owed, coupon.remainingAmount);
    const remaining = coupon.remainingAmount.minus(take);
    const taken = await tx.clientCoupon.updateMany({
      where: { id: coupon.id, remainingAmount: coupon.remainingAmount, status: { not: "cancelled" }, usage: { in: ["unused", "partiallyUsed"] } },
      data: { remainingAmount: remaining, usage: usageFor(remaining, coupon.amount), scannedAt: now },
    });
    if (taken.count !== 1) {
      throw new AppError(409, "COUPON_IN_USE", `Coupon ${coupon.code} was just used elsewhere; scan it again`, { coupon: coupon.code });
    }
    await tx.couponRedemption.create({
      data: { clientCouponId: coupon.id, generalTransactionId: input.generalTransactionId, siteId: input.siteId, amount: take, redeemedBy: input.redeemedBy },
    });
    redemptions.push({ code: coupon.code, amount: take, remainingAmount: remaining });
    owed = owed.minus(take);
  }
  return { covered: input.saleAmount.minus(owed), redemptions };
}
