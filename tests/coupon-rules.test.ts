import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { couponExpiry, redeemCoupons, usageFor } from "../src/modules/client-coupons/coupon-rules.js";

const d = (value: number) => new Prisma.Decimal(value);

/** Coupons as the database would hold them, with update and redemption spies. */
function tx(coupons: Array<{ code: string; remaining: number; amount?: number; status?: string; usage?: string }>, { race = false } = {}) {
  const rows = coupons.map((c, i) => ({
    id: `id-${i}`, code: c.code, token: `token-${i}`, amount: d(c.amount ?? 1000), remainingAmount: d(c.remaining),
    status: c.status ?? "available", usage: c.usage ?? (c.remaining === 0 ? "used" : c.remaining < (c.amount ?? 1000) ? "partiallyUsed" : "unused"), expiresAt: null,
  }));
  return {
    rows,
    clientCoupon: {
      updateMany: vi.fn().mockImplementation(async ({ where }) => ({ count: where.id && race ? 0 : 1 })),
      findMany: vi.fn().mockResolvedValue(rows),
    },
    couponRedemption: { create: vi.fn() },
  };
}
const redeem = (db: ReturnType<typeof tx>, scans: string[], sale: number) =>
  redeemCoupons(db as never, { scans, saleAmount: d(sale), generalTransactionId: "sale", siteId: "site", redeemedBy: "attendant" });

describe("coupon usage and expiry", () => {
  it("reads usage from what is left", () => {
    expect(usageFor(d(1000), d(1000))).toBe("unused");
    expect(usageFor(d(500), d(1000))).toBe("partiallyUsed");
    expect(usageFor(d(0), d(1000))).toBe("used");
  });

  it("expires a coupon validityDays after issue, or never", () => {
    expect(couponExpiry(30, new Date("2026-10-01T00:00:00Z"))?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(couponExpiry(null)).toBeNull();
  });
});

describe("spending scanned coupons", () => {
  it("uses five whole and the sixth in part for a 5,500 sale", async () => {
    const db = tx(["A", "B", "C", "D", "E", "F"].map((code) => ({ code, remaining: 1000 })));
    const result = await redeem(db, ["A", "B", "C", "D", "E", "F"], 5500);
    expect(result.covered.toString()).toBe("5500");
    expect(result.redemptions.map((r) => `${r.code}:${r.amount}/${r.remainingAmount}`))
      .toEqual(["A:1000/0", "B:1000/0", "C:1000/0", "D:1000/0", "E:1000/0", "F:500/500"]);
    expect(db.clientCoupon.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ remainingAmount: d(500), usage: "partiallyUsed" }),
    }));
    expect(db.couponRedemption.create).toHaveBeenCalledTimes(6);
  });

  it("covers only part of a sale when the coupons fall short", async () => {
    const result = await redeem(tx([{ code: "A", remaining: 500, amount: 1000 }]), ["A"], 2000);
    expect(result.covered.toString()).toBe("500");
  });

  it("finds a coupon by its QR token as well as its code, in any case", async () => {
    const result = await redeem(tx([{ code: "CPN-AAAA", remaining: 1000 }, { code: "CPN-BBBB", remaining: 1000 }]), ["token-0", "cpn-bbbb"], 1500);
    expect(result.redemptions.map((r) => r.code)).toEqual(["CPN-AAAA", "CPN-BBBB"]);
  });

  it("refuses a coupon the sale does not need, scanned twice, used, cancelled or unknown", async () => {
    await expect(redeem(tx([{ code: "A", remaining: 1000 }, { code: "B", remaining: 1000 }]), ["A", "B"], 800))
      .rejects.toMatchObject({ code: "COUPON_NOT_NEEDED" });
    await expect(redeem(tx([{ code: "A", remaining: 1000 }]), ["A", "A"], 3000)).rejects.toMatchObject({ code: "DUPLICATE_COUPON" });
    await expect(redeem(tx([{ code: "A", remaining: 0 }]), ["A"], 100)).rejects.toMatchObject({ code: "COUPON_USED" });
    await expect(redeem(tx([{ code: "A", remaining: 1000, status: "cancelled" }]), ["A"], 100)).rejects.toMatchObject({ code: "COUPON_CANCELLED" });
    await expect(redeem(tx([{ code: "A", remaining: 1000, usage: "expired" }]), ["A"], 100)).rejects.toMatchObject({ code: "COUPON_EXPIRED" });
    await expect(redeem(tx([]), ["NOPE"], 100)).rejects.toMatchObject({ code: "COUPON_NOT_FOUND" });
  });

  it("loses the race cleanly when another pump spends the coupon first", async () => {
    await expect(redeem(tx([{ code: "A", remaining: 1000 }], { race: true }), ["A"], 500))
      .rejects.toMatchObject({ statusCode: 409, code: "COUPON_IN_USE" });
  });
});
