import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { hashClientPin, verifyClientPin } from "../src/modules/clients/client-pin.js";
import { hashPin } from "../src/utils/crypto.js";
import { CouponSaleRepository } from "../src/modules/mobile/coupon-sales/coupon-sale.repository.js";
import { confirmCouponSaleSchema, initiateCouponSaleSchema } from "../src/modules/mobile/coupon-sales/coupon-sale.schema.js";
import { MobileTransactionsRepository } from "../src/modules/mobile/transactions/transactions.repository.js";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const d = (value: number) => new Prisma.Decimal(value);

describe("client PIN", () => {
  it("checks the PIN it hashed, and hashes apart from a user PIN with the same digits", () => {
    const stored = hashClientPin("2468", "secret");
    expect(verifyClientPin("2468", stored, "secret")).toBe(true);
    expect(verifyClientPin("1357", stored, "secret")).toBe(false);
    expect(stored).not.toBe(hashPin("2468", "secret"));
  });
});

describe("coupon sale input", () => {
  const initiate = {
    clientId: id(1), clientPin: "2468", itemId: id(2), cuveId: id(3), pumpId: id(4), nozzleId: id(5),
    quantity: "1.5", amount: "2250",
  };

  it("takes the fuel and the client's PIN at initiate, and nothing about payment", () => {
    expect(initiateCouponSaleSchema.safeParse(initiate).success).toBe(true);
    expect(initiateCouponSaleSchema.safeParse({ ...initiate, clientPin: undefined }).success).toBe(false);
    expect(initiateCouponSaleSchema.safeParse({ ...initiate, payments: [] }).success).toBe(false);
  });

  it("reads the coupons from a JSON form field or an array, at least one", () => {
    const confirm = { clientId: id(1), phone: "0788 000 000", pin: "1234" };
    expect(confirmCouponSaleSchema.parse({ ...confirm, coupons: '["CPN-A","CPN-B"]' }).coupons).toEqual(["CPN-A", "CPN-B"]);
    expect(confirmCouponSaleSchema.parse({ ...confirm, coupons: ["CPN-A"], printStatus: "true" }).printStatus).toBe(true);
    expect(confirmCouponSaleSchema.safeParse({ ...confirm, coupons: [] }).success).toBe(false);
    expect(confirmCouponSaleSchema.safeParse({ ...confirm, coupons: "CPN-A" }).success).toBe(false);
  });
});

/** A coupon sale as `openSale` reads it, inside a transaction that runs its callback. */
function couponDb(sale: Record<string, unknown>, { claimed = 1 } = {}) {
  const tx = {
    generalTransaction: {
      findFirst: vi.fn().mockResolvedValue({
        id: "sale", status: "initiated", expiresAt: null, clientId: id(1), quantity: d(1.5), unitPrice: d(1500), amount: d(2250),
        cuveId: "cuve", cuve: { name: "Tank 1" }, nozzle: { id: "nozzle", name: "N1", pump: { id: "pump", name: "P1" } },
        ...sale,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: claimed }),
    },
  };
  return { tx, db: { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)) } };
}
const confirmWith = (db: unknown, clientId = id(1)) =>
  new CouponSaleRepository(db as never, "secret", {} as never).confirm("PSST20261017-120000-000", "site", { clientId, coupons: ["CPN-A"] }, "attendant");

describe("confirming a coupon sale", () => {
  it("refuses a sale that is not paid with coupons", async () => {
    const { db } = couponDb({ expiresAt: new Date() });
    await expect(confirmWith(db)).rejects.toMatchObject({ code: "NOT_A_COUPON_SALE" });
  });

  it("refuses coupons for another client than the one the sale was started for", async () => {
    const { db, tx } = couponDb({});
    await expect(confirmWith(db, id(9))).rejects.toMatchObject({ code: "CLIENT_MISMATCH" });
    expect(tx.generalTransaction.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a sale already confirmed or cancelled", async () => {
    await expect(confirmWith(couponDb({ status: "confirmed" }).db)).rejects.toMatchObject({ code: "TRANSACTION_ALREADY_CONFIRMED" });
    await expect(confirmWith(couponDb({ status: "cancelled" }).db)).rejects.toMatchObject({ code: "TRANSACTION_CANCELLED" });
    await expect(confirmWith(couponDb({}, { claimed: 0 }).db)).rejects.toMatchObject({ code: "TRANSACTION_ALREADY_CONFIRMED" });
  });

  it("is refused by the ordinary confirm, which would take other payments", async () => {
    const tx = { generalTransaction: { findFirst: vi.fn().mockResolvedValue({ id: "sale", status: "initiated", expiresAt: null }), updateMany: vi.fn() } };
    const db = {
      generalTransaction: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const repo = new MobileTransactionsRepository(db as never, "secret");
    await expect(repo.confirm("PSST20261017-120000-000", "site", { referenceDocs: {} } as never, "attendant"))
      .rejects.toMatchObject({ statusCode: 409, code: "COUPON_SALE" });
    expect(tx.generalTransaction.updateMany).not.toHaveBeenCalled();
  });
});
