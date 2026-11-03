import { describe, expect, it, vi } from "vitest";
import { allowedToleranceRate, toleranceColumns, toleranceFor } from "../src/modules/central-stock/tolerance-rules.js";

/** 40,000 litres cleared at the border, as a tanker carries. */
const trip = (received: number, allowedRate: number | null = 1) =>
  toleranceFor({ t1Quantity: 40_000, receivedQuantity: received, allowedRate });

describe("what a trip lost or gained", () => {
  it("counts a short delivery as a loss, and says what share of the load it is", () => {
    const tolerance = trip(39_760);
    expect(tolerance.lossQty.toString()).toBe("240");
    expect(tolerance.gainQty.toString()).toBe("0");
    expect(tolerance.rate.toString()).toBe("0.6");
    // 1% of 40,000 is 400, and 240 is inside it.
    expect(tolerance.allowedQuantity!.toString()).toBe("400");
    expect(tolerance.withinTolerance).toBe(true);
  });

  it("counts more than was cleared as a gain, judged by the same allowance", () => {
    const tolerance = trip(40_150);
    expect(tolerance.gainQty.toString()).toBe("150");
    expect(tolerance.lossQty.toString()).toBe("0");
    expect(tolerance.difference.toString()).toBe("-150");
    expect(tolerance.withinTolerance).toBe(true);
    // 500 more than was cleared is as much a question as 500 fewer.
    expect(trip(40_500).withinTolerance).toBe(false);
  });

  it("puts a trip outside the allowance over tolerance", () => {
    const tolerance = trip(39_400);
    expect(tolerance.lossQty.toString()).toBe("600");
    expect(tolerance.rate.toString()).toBe("1.5");
    expect(tolerance.withinTolerance).toBe(false);
  });

  it("calls the allowance exactly met within it, not over", () => {
    expect(trip(39_600).lossQty.toString()).toBe("400");
    expect(trip(39_600).withinTolerance).toBe(true);
  });

  it("leaves a product with no rate unjudged rather than passing it", () => {
    const tolerance = trip(39_400, null);
    // The litres are still counted; only the verdict is withheld.
    expect(tolerance.lossQty.toString()).toBe("600");
    expect(tolerance.allowedRate).toBeNull();
    expect(tolerance.allowedQuantity).toBeNull();
    expect(tolerance.withinTolerance).toBeNull();
  });

  it("does not divide by a trip that cleared nothing", () => {
    const tolerance = toleranceFor({ t1Quantity: 0, receivedQuantity: 0, allowedRate: 1 });
    expect(tolerance.rate.toString()).toBe("0");
    expect(tolerance.withinTolerance).toBe(true);
  });

  it("rounds to the two decimals the columns hold", () => {
    const tolerance = toleranceFor({ t1Quantity: "33333.33", receivedQuantity: "33000.11", allowedRate: "1.5" });
    expect(tolerance.lossQty.toString()).toBe("333.22");
    expect(tolerance.rate.toString()).toBe("1");
    expect(tolerance.allowedQuantity!.toString()).toBe("500");
  });

  it("stores the allowance in force, not the difference", () => {
    // `toleranceRate` on a receipt is what the product was allowed that day;
    // what it actually lost is `lossQty`. Confusing the two would re-judge
    // past trips whenever the rate changed.
    const columns = toleranceColumns(trip(39_400));
    expect(columns.toleranceRate!.toString()).toBe("1");
    expect(columns.lossQty.toString()).toBe("600");
    expect(columns.gainQty.toString()).toBe("0");
  });
});

describe("the allowance a product carries", () => {
  it("takes the active rate, newest first", async () => {
    const db = { itemToleranceRate: { findFirst: vi.fn().mockResolvedValue({ maxRate: 1.5 }) } };
    await expect(allowedToleranceRate(db as never, "item")).resolves.toBe(1.5);
    const { where, orderBy } = db.itemToleranceRate.findFirst.mock.calls[0][0];
    expect(where).toEqual({ itemId: "item", status: "active" });
    expect(orderBy).toEqual({ updatedAt: "desc" });
  });

  it("is null when the product has none set", async () => {
    const db = { itemToleranceRate: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(allowedToleranceRate(db as never, "item")).resolves.toBeNull();
  });
});

describe("what the transporter is answerable for", () => {
  it("charges the short beyond the allowance, and nothing within it", () => {
    // 2,000 cleared, 0.3% allows 6; 1,600 delivered is 400 short, so 394 is
    // theirs — the user's own worked example.
    const tolerance = toleranceFor({ t1Quantity: 2_000, receivedQuantity: 1_600, allowedRate: "0.3" });
    expect(tolerance.allowedQuantity!.toString()).toBe("6");
    expect(tolerance.lossQty.toString()).toBe("400");
    expect(tolerance.chargeableQty!.toString()).toBe("394");
  });

  it("charges nothing for a trip inside its allowance", () => {
    expect(trip(39_760).chargeableQty!.toString()).toBe("0");
    // Exactly the allowance is still inside it.
    expect(trip(39_600).chargeableQty!.toString()).toBe("0");
  });

  it("charges nothing for a gain, however far over", () => {
    // A load that arrives over is not something the transporter owes, even
    // when it is outside the allowance and so worth asking about.
    const over = trip(40_500);
    expect(over.withinTolerance).toBe(false);
    expect(over.chargeableQty!.toString()).toBe("0");
  });

  it("charges nothing when the product carries no rate", () => {
    // Nothing can be charged against an allowance nobody has set.
    expect(trip(39_400, null).chargeableQty).toBeNull();
  });
});
