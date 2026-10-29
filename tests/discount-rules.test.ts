import { describe, expect, it } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { bestDiscount, discountColumns, priceWithDiscount } from "../src/modules/discounts/discount-rules.js";

const decimal = (value: number | string) => new Prisma.Decimal(value);

const SITE = "site-1";
const OTHER_SITE = "site-2";
const CLIENT = "client-1";

/** A candidate as `discountsInForce` returns one. */
function fixed(id: string, value: number, clientId: string | null = CLIENT, createdAt = new Date("2026-10-01")) {
  return { id, type: "fixed" as const, value: decimal(value), clientId, siteId: null, createdAt, rangingDiscounts: [] };
}

function ranging(id: string, tiers: Array<[number, number, number]>, createdAt = new Date("2026-10-01")) {
  return {
    id, type: "ranging" as const, value: decimal(0), clientId: null, siteId: null, createdAt,
    rangingDiscounts: tiers.map(([from, to, rate], index) => ({
      id: `${id}-t${index}`, from: decimal(from), to: decimal(to), rate: decimal(rate),
    })),
  };
}

describe("the discount one sale gets", () => {
  it("takes the rate as a percentage of what the sale is worth", () => {
    // 15% of 60,000 is 9,000 — the litres do not come into it.
    const best = bestDiscount([fixed("d", 15)], decimal(40), decimal(60_000));
    expect(best?.amount.toString()).toBe("9000");
    expect(best?.rate.toString()).toBe("15");
  });

  it("rounds the discount to the two decimals the money columns hold", () => {
    // 11.34 litres at 1,764 a litre: 20,003.76 gross, and 10% of it is
    // 2,000.376 — which is charged as 2,000.38.
    const best = bestDiscount([fixed("d", 10)], decimal("11.34"), decimal("20003.76"));
    expect(best?.amount.toString()).toBe("2000.38");
  });

  it("uses the volume tier the quantity falls in", () => {
    // The litres pick the band; the band's percentage then prices the sale.
    const discount = ranging("d", [[0, 100, 2], [100, 500, 5]]);
    expect(bestDiscount([discount], decimal(50), decimal(75_000))?.amount.toString()).toBe("1500");
    expect(bestDiscount([discount], decimal(200), decimal(300_000))?.amount.toString()).toBe("15000");
  });

  it("gives a shared bound to the higher band", () => {
    const best = bestDiscount([ranging("d", [[0, 100, 2], [100, 500, 5]])], decimal(100), decimal(150_000));
    expect(best?.rate.toString()).toBe("5");
    expect(best?.tier?.from.toString()).toBe("100");
  });

  it("gives nothing when the volume is outside every tier", () => {
    expect(bestDiscount([ranging("d", [[100, 500, 5]])], decimal(20), decimal(30_000))).toBeNull();
  });

  it("takes the best single discount and never adds two together", () => {
    // The client's own rate is 15%; the volume promotion is 5%.
    const best = bestDiscount([fixed("own", 15), ranging("promo", [[0, 1000, 5]])], decimal(40), decimal(60_000));
    expect(best?.discountId).toBe("own");
    expect(best?.amount.toString()).toBe("9000");
  });

  it("prefers the client's own rate when two come to the same", () => {
    const best = bestDiscount([ranging("promo", [[0, 1000, 10]]), fixed("own", 10)], decimal(40), decimal(60_000));
    expect(best?.discountId).toBe("own");
  });

  it("never discounts more than the sale is worth", () => {
    // A rate written above 100% — which the input schema refuses, but a row
    // left over from the per-litre rates would read as — gives the sale away
    // rather than paying the customer.
    const best = bestDiscount([fixed("d", 5000)], decimal(40), decimal(60_000));
    expect(best?.amount.toString()).toBe("60000");
  });

  it("ignores a rate of zero", () => {
    expect(bestDiscount([fixed("d", 0)], decimal(40), decimal(60_000))).toBeNull();
  });
});

describe("what the sale is charged", () => {
  /** A stand-in for `db.discount.findMany`, so the rules can be checked without a database. */
  const dbWith = (rows: unknown[]) => ({ discount: { findMany: async () => rows } }) as never;

  it("subtracts the discount from the gross the pump shows", async () => {
    const priced = await priceWithDiscount(dbWith([ranging("d", [[0, 100, 20]])]), {
      siteId: SITE, quantity: decimal(40), unitPrice: decimal(1500),
    });
    expect(priced.grossAmount.toString()).toBe("60000");
    expect(priced.discountAmount.toString()).toBe("12000");
    expect(priced.amount.toString()).toBe("48000");
  });

  it("charges the full price when nothing is in force", async () => {
    const priced = await priceWithDiscount(dbWith([]), { siteId: SITE, quantity: decimal(40), unitPrice: decimal(1500) });
    expect(priced.amount.toString()).toBe("60000");
    expect(priced.discount).toBeNull();
    expect(discountColumns(priced)).toEqual({
      discountId: null, discountRate: decimal("0.00"), discountAmount: decimal("0.00"),
    });
  });

  it("copies the rate onto the sale, so editing the discount cannot rewrite it", async () => {
    const priced = await priceWithDiscount(dbWith([fixed("d", 25)]), {
      siteId: SITE, quantity: decimal(10), unitPrice: decimal(1500),
    });
    const columns = discountColumns(priced);
    expect(columns.discountId).toBe("d");
    expect(columns.discountRate.toString()).toBe("25");
    expect(columns.discountAmount.toString()).toBe("3750");
  });

  it("prices the worked example end to end", async () => {
    const priced = await priceWithDiscount(dbWith([fixed("d", 10)]), {
      siteId: SITE, quantity: decimal("11.34"), unitPrice: decimal(1764),
    });
    expect(priced.grossAmount.toString()).toBe("20003.76");
    expect(priced.discountAmount.toString()).toBe("2000.38");
    expect(priced.amount.toString()).toBe("18003.38");
  });
});

describe("tiers of another site", () => {
  it("are never used: only this site's tiers are fetched", () => {
    // `discountsInForce` filters tiers by site, so a discount arrives with no
    // tier for a volume sold elsewhere — and gives nothing.
    const elsewhere = { ...ranging("d", []), siteId: OTHER_SITE };
    expect(bestDiscount([elsewhere], decimal(200), decimal(300_000))).toBeNull();
  });
});
