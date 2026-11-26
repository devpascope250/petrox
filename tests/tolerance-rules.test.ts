import { describe, expect, it, vi } from "vitest";
import {
  allowedToleranceRate, receivedAsRecorded, sumReceivedMovements, toleranceColumns, toleranceFor,
} from "../src/modules/central-stock/tolerance-rules.js";
import { receiptWindow } from "../src/modules/central-stock/receipt-window.js";

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

/**
 * A reconciliation months later must not re-judge a trip already made.
 *
 * `CentralStock.quantityAt20C` doubles as the receipt's running balance, so
 * every reconciliation moves it. Grading a trip against it would turn a depot
 * discrepancy found in March into a shortfall charged to whoever drove in
 * November — on a report with a "send to transporter" button on it.
 */
describe("what a receipt was recorded as taking in", () => {
  const taken = (options: {
    lossQty: number | null;
    gainQty: number | null;
    quantityAt20C: number;
  }) => receivedAsRecorded({ t1Quantity: 40_000, ...options }).toString();

  it("reads the snapshot, not the balance the receipt has been reduced to", () => {
    // Took in exactly what the T1 cleared, then 2,000 was reconciled out.
    expect(taken({ lossQty: 0, gainQty: 0, quantityAt20C: 38_000 })).toBe("40000");
  });

  it("keeps a real shortfall intact", () => {
    expect(taken({ lossQty: 240, gainQty: 0, quantityAt20C: 39_760 })).toBe("39760");
    // And still does after a later reconciliation moved the balance.
    expect(taken({ lossQty: 240, gainQty: 0, quantityAt20C: 10_000 })).toBe("39760");
  });

  it("keeps a real gain intact", () => {
    expect(taken({ lossQty: 0, gainQty: 500, quantityAt20C: 40_500 })).toBe("40500");
  });

  it("falls back to the live column when there is no snapshot", () => {
    // Receipts written before those columns existed have nothing to read, and
    // dropping them from the report would be worse than grading them as they
    // stand.
    expect(taken({ lossQty: null, gainQty: null, quantityAt20C: 39_000 })).toBe("39000");
  });

  it("treats a recorded zero as a snapshot, not as a missing one", () => {
    // Both columns zero is a trip that arrived exactly — the test has to be
    // nullness, never truthiness.
    expect(taken({ lossQty: 0, gainQty: null, quantityAt20C: 1 })).toBe("40000");
  });

  /**
   * The snapshot-less case is not a historical curiosity: every receipt
   * recorded before the tolerance columns existed takes it, and reading the
   * balance column there reported a receipt reconciled out in full as having
   * lost its entire load — −100%, "over tolerance", charged to a driver who
   * had delivered exactly what he carried.
   */
  describe("a receipt with no snapshot", () => {
    const movements = (quantity: number) => [{ quantity, type: "received" }];

    it("is graded on what arrived, not on the balance it has been reduced to", () => {
      expect(receivedAsRecorded({
        t1Quantity: 40_000, lossQty: null, gainQty: null,
        receivedMovements: sumReceivedMovements(movements(39_748)),
        // Reconciled out in full: the column says there is nothing left.
        quantityAt20C: 0,
      }).toString()).toBe("39748");
    });

    it("still falls back to the column when no movement can be found", () => {
      // Better than grading it on nothing, and it is what the figure was in
      // every case before the movements were consulted.
      expect(receivedAsRecorded({
        t1Quantity: 40_000, lossQty: null, gainQty: null,
        receivedMovements: sumReceivedMovements([]),
        quantityAt20C: 39_000,
      }).toString()).toBe("39000");
    });

    it("ignores the movements once a snapshot exists", () => {
      // The snapshot is the figure the trip was judged on; the movements must
      // not re-grade it.
      expect(receivedAsRecorded({
        t1Quantity: 40_000, lossQty: 240, gainQty: 0,
        receivedMovements: sumReceivedMovements(movements(1)),
        quantityAt20C: 1,
      }).toString()).toBe("39760");
    });

    it("counts only the received rows, never a reconciliation", () => {
      const total = sumReceivedMovements([
        { quantity: 40_000, type: "received" },
        { quantity: 39_748, type: "reconcilliationOut" },
        { quantity: 500, type: "saleOut" },
        { quantity: 100, type: "reconcilliationIn" },
      ]);
      expect(total.toString()).toBe("40000");
    });
  });

  it("round-trips whatever toleranceFor stored, so the two cannot disagree", () => {
    for (const received of [40_000, 39_760, 40_500, 0]) {
      const stored = toleranceFor({ t1Quantity: 40_000, receivedQuantity: received, allowedRate: 1 });
      expect(receivedAsRecorded({
        t1Quantity: 40_000,
        lossQty: stored.lossQty,
        gainQty: stored.gainQty,
        // Deliberately wrong, to prove it is not consulted.
        quantityAt20C: -1,
      }).toString()).toBe(String(received));
    }
  });
});

/**
 * A dated report asked about October should answer about October's fuel, not
 * October's typing. `createdAt` is `@default(now())` and nothing can set it, so
 * a backlog keyed in today would otherwise all land in today's window.
 */
describe("the window a dated report puts over receipts", () => {
  const from = new Date("2026-10-01");
  const to = new Date("2026-10-31");

  it("asks for the discharge date, and falls back to the typing date", () => {
    expect(receiptWindow(from, to)).toEqual({
      OR: [
        { offloadingDate: { gte: from, lte: to } },
        // Only where no discharge date was recorded — so a receipt that states
        // one is never also matched by when it was keyed in.
        { offloadingDate: null, createdAt: { gte: from, lte: to } },
      ],
    });
  });

  it("is empty when no window is asked for, so it can be spread anywhere", () => {
    expect(receiptWindow()).toEqual({});
  });

  it("takes an open-ended window", () => {
    expect(receiptWindow(from, undefined)).toEqual({
      OR: [
        { offloadingDate: { gte: from, lte: undefined } },
        { offloadingDate: null, createdAt: { gte: from, lte: undefined } },
      ],
    });
  });
});
