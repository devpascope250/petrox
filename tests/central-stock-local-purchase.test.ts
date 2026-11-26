import { describe, expect, it, vi } from "vitest";
import { CentralStockRepository } from "../src/modules/central-stock/central-stock.repository.js";
import { createCentralStockSchema } from "../src/modules/central-stock/central-stock.schema.js";

/**
 * Taking fuel into a depot from a **local supplier** rather than across a
 * border.
 *
 * The whole distinction is that such a receipt has no T1 validation, and that
 * single fact has to carry everything: no trip to close off, no parking to
 * release, no transporter to hold to a tolerance, and a price on the receipt
 * because there is no cargo invoice behind it. These check that the T1 branch
 * is genuinely skipped rather than merely passed a null, and that the two
 * kinds of receipt cannot be mixed into one row.
 */

const LOCAL = {
  // Stated, not inferred: with the T1 column relaxed to optional, a request
  // that merely omitted one would otherwise be written as a local purchase in
  // silence. See the schema's refinements.
  source: "local" as const,
  deportId: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  createdBy: "33333333-3333-4333-8333-333333333333",
  ambQuantity: "30000",
  quantityAt20C: "30000",
  receiptNumber: "LOCAL-001",
};
const T1_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_DEPOT = "55555555-5555-4555-8555-555555555555";

function repoFor(options: {
  /** What `deport.findMany` answers with, i.e. the depots named on the input. */
  depots?: Array<{ id: string; name: string; type: string }>;
  currency?: { id: string } | null;
} = {}) {
  const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "receipt-1", ...data }));
  const t1FindFirst = vi.fn().mockResolvedValue({ nominationId: "nomination-1" });
  const tx = {
    centralStock: { create },
    t1Validation: {
      findFirst: t1FindFirst,
      // Read by `toleranceForReceipt`, which only the imported branch calls.
      findUnique: vi.fn().mockResolvedValue({ quantityAt20C: "30000" }),
    },
    feeType: { findMany: vi.fn().mockResolvedValue([]) },
    nomination: { findUnique: vi.fn().mockResolvedValue(null) },
    itemToleranceRate: { findFirst: vi.fn().mockResolvedValue({ maxRate: "1" }) },
    // Only the imported branch reaches these: closing the trip off and
    // releasing the truck's parking. Stubbed so that branch can be exercised
    // and shown to leave the local checks alone.
    nominationTimeLineStatus: { findFirst: vi.fn().mockResolvedValue({ id: "stage-1", level: 5, status: "stockReceived" }) },
    nominationTimeLine: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    vehicleLocation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    centralStock: { findFirst: vi.fn().mockResolvedValue(null), create },
    t1Validation: { findFirst: t1FindFirst, findUnique: vi.fn().mockResolvedValue({ quantityAt20C: "30000" }) },
    currency: {
      findFirst: vi.fn().mockResolvedValue(
        options.currency === undefined ? { id: "currency-1" } : options.currency,
      ),
    },
    deport: {
      findMany: vi.fn().mockResolvedValue(
        options.depots ?? [{ id: LOCAL.deportId, name: "Kabuye", type: "local" }],
      ),
    },
    $transaction: vi.fn().mockImplementation((run: (t: unknown) => unknown) => run(tx)),
  };
  return { repo: new CentralStockRepository(db as never), create, t1FindFirst, db };
}

describe("the shape a local purchase has to arrive in", () => {
  it("is accepted with a price, a currency and a truck and no T1", () => {
    const parsed = createCentralStockSchema.parse({
      ...LOCAL,
      unitPrice: "1250.50",
      currencyCode: "rwf",
      truckNumber: " RAB123F/TR-884 ",
      sdReference: "  SD-2026-0471  ",
    });

    expect(parsed.t1ValidationId).toBeNull();
    expect(parsed.unitPrice).toBe(1250.5);
    // Upper-cased and trimmed so one purchase's "rwf" and another's "RWF"
    // group together in a report rather than reading as two currencies.
    expect(parsed.currencyCode).toBe("RWF");
    expect(parsed.truckNumber).toBe("RAB123F/TR-884");
    // Trimmed but not re-cased: it is the supplier's own numbering, so it is
    // stored exactly as they wrote it.
    expect(parsed.sdReference).toBe("SD-2026-0471");
  });

  /*
   * The old NOT NULL, moved from the column to the request. Relaxing the
   * column was necessary; letting a forgotten T1 pass as a local purchase was
   * not, and on a live database it would have written priceless receipts that
   * no report could explain.
   */
  it("still demands a T1 when none is claimed to be local", () => {
    const { source: _ignored, ...withoutSource } = LOCAL;
    const result = createCentralStockSchema.safeParse(withoutSource);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("source=local");
  });

  it("refuses a request that calls itself local while carrying a T1", () => {
    const result = createCentralStockSchema.safeParse({ ...LOCAL, t1ValidationId: T1_ID });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("no T1 validation");
  });

  it("still accepts an imported receipt exactly as before", () => {
    const parsed = createCentralStockSchema.parse({ ...LOCAL, source: "import" as const, t1ValidationId: T1_ID });

    expect(parsed.t1ValidationId).toBe(T1_ID);
    expect(parsed.unitPrice).toBeNull();
    // Null rather than `""`: a blank field is "none", not an empty reference.
    expect(parsed.truckNumber).toBeNull();
  });

  it("treats an empty T1 the same as none, since a form sends \"\"", () => {
    expect(createCentralStockSchema.parse({ ...LOCAL, t1ValidationId: "" }).t1ValidationId).toBeNull();
  });

  /*
   * The refinements below are the only thing standing between a half-imported,
   * half-local row and the database: there is no stored `type` to check it
   * against, so a row that claimed both would leave every reader guessing.
   */
  it("refuses a unit price on an imported receipt", () => {
    const result = createCentralStockSchema.safeParse({
      ...LOCAL, source: "import" as const, t1ValidationId: T1_ID, unitPrice: "1200", currencyCode: "RWF",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("landing fees");
  });

  it("refuses a typed truck number on an imported receipt", () => {
    const result = createCentralStockSchema.safeParse({
      ...LOCAL, source: "import" as const, t1ValidationId: T1_ID, truckNumber: "RAB123F",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("nomination");
  });

  it("refuses a supplier reference on an imported receipt", () => {
    // An import is traced through its T1 and its cargo's BL. A supplier's
    // delivery reference on the same row would leave two competing answers to
    // which document the receipt is.
    const result = createCentralStockSchema.safeParse({
      ...LOCAL, source: "import" as const, t1ValidationId: T1_ID, sdReference: "SD-2026-0471",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("supplier reference");
  });

  it("treats a blank supplier reference as none, not as an empty string", () => {
    // Not every supplier issues one, and a form always sends the field.
    expect(createCentralStockSchema.parse({ ...LOCAL, sdReference: "" }).sdReference).toBeNull();
  });

  it("refuses a price with no currency, and a currency with no price", () => {
    expect(createCentralStockSchema.safeParse({ ...LOCAL, unitPrice: "1200" }).success).toBe(false);
    expect(createCentralStockSchema.safeParse({ ...LOCAL, currencyCode: "RWF" }).success).toBe(false);
  });

  it("refuses clearing an imported load on arrival, which is the authorizers' job", () => {
    const result = createCentralStockSchema.safeParse({
      ...LOCAL, source: "import" as const, t1ValidationId: T1_ID, arrivesCleared: "true",
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("clearance request");
  });
});

describe("writing a local purchase", () => {
  it("skips the T1 branch entirely rather than looking one up", async () => {
    const { repo, create, t1FindFirst } = repoFor();
    await repo.create(createCentralStockSchema.parse({
      ...LOCAL, unitPrice: "1250", currencyCode: "RWF", truckNumber: "RAB123F/TR-884",
      sdReference: "SD-2026-0471",
    }));

    // No nomination to close off and no parking to release, so the T1 is never
    // read: there is no trip behind this load at all.
    expect(t1FindFirst).not.toHaveBeenCalled();
    const { data } = create.mock.calls[0]![0];
    expect(data.t1ValidationId).toBeNull();
    expect(Number(data.unitPrice)).toBe(1250);
    expect(data.currencyCode).toBe("RWF");
    expect(data.truckNumber).toBe("RAB123F/TR-884");
    expect(data.sdReference).toBe("SD-2026-0471");
  });

  it("leaves loss, gain and the allowance unrecorded", async () => {
    const { repo, create } = repoFor();
    await repo.create(createCentralStockSchema.parse(LOCAL));

    /*
     * Not zero — unrecorded. Tolerance is `t1 - received`, so with no T1 there
     * is no figure and nobody to attribute it to. `receivedAsRecorded()` reads
     * both columns being absent as "never recorded" and falls back to the
     * quantity itself, which is the right answer for a local purchase.
     */
    const { data } = create.mock.calls[0]![0];
    expect(data.lossQty).toBeUndefined();
    expect(data.gainQty).toBeUndefined();
    expect(data.toleranceRate).toBeUndefined();
  });

  it("still writes the received movement, so the fuel has a balance", async () => {
    const { repo, create } = repoFor();
    await repo.create(createCentralStockSchema.parse(LOCAL));

    // The ledger is what every balance is summed from. A receipt without its
    // `received` row would be fuel standing in a depot with nothing in it.
    const { data } = create.mock.calls[0]![0];
    expect(data.transactions.create).toMatchObject({ quantity: 30000, type: "received" });
  });

  it("clears the whole receipt when the supplier delivered it duty-paid", async () => {
    const { repo, create } = repoFor();
    await repo.create(createCentralStockSchema.parse({
      ...LOCAL, arrivesCleared: "true", supportingDocUrl: "/uploads/supplier.pdf",
    }));

    /*
     * A row, not a flag: a clearance is a quantity that sales draw against.
     * It carries the supplier's document and no `requestId` — there is nothing
     * for the authorizers to approve when the duty is already settled, and the
     * document is what tells it apart from a cleared row that simply never
     * went through the process.
     */
    const { data } = create.mock.calls[0]![0];
    expect(data.stockClearances.create).toMatchObject({
      quantity: 30000,
      status: "cleared",
      supportingDocUrl: "/uploads/supplier.pdf",
    });
    expect(data.stockClearances.create.requestId).toBeUndefined();
  });

  it("writes no clearance when the load arrives uncleared", async () => {
    const { repo, create } = repoFor();
    await repo.create(createCentralStockSchema.parse(LOCAL));

    expect(create.mock.calls[0]![0].data.stockClearances).toBeUndefined();
  });

  it("refuses a currency that is not on record", async () => {
    const { repo } = repoFor({ currency: null });
    await expect(repo.create(createCentralStockSchema.parse({
      ...LOCAL, unitPrice: "1200", currencyCode: "ZZZ",
    }))).rejects.toThrow(/not a currency on record/);
  });

  it("refuses to deliver a local purchase into a foreign depot", async () => {
    // A local supplier cannot discharge abroad, and a receipt claiming so
    // would corrupt the stock position of a depot holding no local stock.
    const { repo } = repoFor({
      depots: [{ id: FOREIGN_DEPOT, name: "Dar es Salaam", type: "foreign" }],
    });
    await expect(repo.create(createCentralStockSchema.parse({
      ...LOCAL, deportId: FOREIGN_DEPOT,
    }))).rejects.toThrow(/foreign depot/);
  });

  it("does not check depots or currency for an imported receipt", async () => {
    const { repo, db } = repoFor();
    await repo.create(createCentralStockSchema.parse({ ...LOCAL, source: "import" as const, t1ValidationId: T1_ID }));

    // An import is discharged wherever its trip took it, and is costed by its
    // cargo — neither question belongs to it.
    expect(db.deport.findMany).not.toHaveBeenCalled();
    expect(db.currency.findFirst).not.toHaveBeenCalled();
  });
});

/**
 * What a reconciliation may take out of a receipt.
 *
 * The guard used to measure the balance against the **clearance quantities**,
 * which froze a fully-cleared receipt: clearing is paperwork saying the duty is
 * settled, not a statement that the litres have left, so a receipt cleared for
 * its whole volume with nothing sold was entirely present and entirely
 * unreconcilable — exactly the case a depot discrepancy has to be recorded
 * against. It now measures against what has actually been **drawn**.
 */
describe("how much of a receipt a reconciliation may remove", () => {
  function reconcileRepo(
    clearances: Array<{ quantity: string; drawn: string[] }>,
    received = "30000",
  ) {
    /*
     * A faithful fake of the movement log rather than a fixed answer: the
     * status is recomputed from the rows that exist **after** the write, so
     * `create` appends and `findMany` hands back what is really there. A
     * stubbed list would pass whatever the status rule did.
     */
    const movements: Array<{ quantity: string; type: string }> = [
      { quantity: received, type: "received" },
    ];
    const create = vi.fn().mockImplementation(({ data }: { data: { quantity: number; type: string } }) => {
      movements.push({ quantity: String(data.quantity), type: data.type });
      return Promise.resolve({ id: "movement-1" });
    });
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      centralStock: {
        findUnique: vi.fn().mockResolvedValue({
          quantityAt20C: received,
          transactions: [{ quantity: received, type: "received" }],
          stockClearances: clearances.map((row) => ({
            quantity: row.quantity,
            centralStockOrders: row.drawn.map((quantity) => ({ quantity })),
          })),
        }),
        update,
      },
      stockClearance: { findFirst: vi.fn().mockResolvedValue({ id: "clearance-1" }), create: vi.fn() },
      stockTransaction: { create, findMany: vi.fn().mockImplementation(() => Promise.resolve(movements)) },
    };
    const db = { $transaction: vi.fn().mockImplementation((run: (t: unknown) => unknown) => run(tx)) };
    return { repo: new CentralStockRepository(db as never), create, update };
  }

  /** The `status` the receipt was left in, from the last update that set one. */
  const statusWritten = (update: ReturnType<typeof vi.fn>) =>
    update.mock.calls
      .map(([args]) => (args as { data?: { status?: string } }).data?.status)
      .filter((status): status is string => Boolean(status))
      .at(-1);

  const out = {
    centralStockId: LOCAL.deportId,
    quantity: 2000,
    reconciliationType: "reconcilliationOut" as const,
    state: "uncleared" as const,
    createdBy: LOCAL.createdBy,
  };

  it("lets a fully-cleared receipt with nothing sold be reconciled out", async () => {
    // 30,000 cleared, none drawn: the fuel is all still standing there.
    const { repo, create } = reconcileRepo([{ quantity: "30000", drawn: [] }]);
    await repo.createReconciliation(out);
    expect(create).toHaveBeenCalled();
  });

  it("still refuses to reduce the balance below what has been drawn", async () => {
    // 29,000 of the 30,000 has been sold through its clearance, so only 1,000
    // is left to correct and 2,000 cannot come out.
    const { repo } = reconcileRepo([{ quantity: "30000", drawn: ["20000", "9000"] }]);
    await expect(repo.createReconciliation(out)).rejects.toThrow(/already been drawn/);
  });

  it("names the figures, so the ceiling is not a mystery", async () => {
    const { repo } = reconcileRepo([{ quantity: "30000", drawn: ["29000"] }]);
    // The old message said only "below cleared or sold allocations", leaving
    // the person to guess what the limit was.
    await expect(repo.createReconciliation(out)).rejects.toThrow(/29000[\s\S]*30000[\s\S]*2000/);
  });

  /**
   * `status` was a column nothing ever wrote: accepted on input, indexed, and
   * filtered on by the allocation picker, but left at `inStock` for the life of
   * every receipt — so a batch reconciled away to nothing went on offering
   * itself to the next order forever.
   */
  describe("the receipt's own status, once the movement is in", () => {
    it("closes a receipt reconciled down to nothing", async () => {
      const { repo, update } = reconcileRepo([{ quantity: "30000", drawn: [] }], "2000");
      // 2,000 received, 2,000 reconciled out: there is nothing left.
      await repo.createReconciliation(out);
      expect(statusWritten(update)).toBe("stockOut");
    });

    it("leaves a receipt open while any of it remains", async () => {
      const { repo, update } = reconcileRepo([{ quantity: "30000", drawn: [] }]);
      // 30,000 received, 2,000 out — 28,000 is still standing in the depot.
      await repo.createReconciliation(out);
      expect(statusWritten(update)).toBe("inStock");
    });

    it("reopens a receipt that is reconciled back up", async () => {
      // The correction of a reconciliation that emptied it: fuel is there
      // again, so it must not stay marked as empty.
      const { repo, update } = reconcileRepo([{ quantity: "30000", drawn: [] }], "0");
      await repo.createReconciliation({ ...out, reconciliationType: "reconcilliationIn" as const });
      expect(statusWritten(update)).toBe("inStock");
    });

    it("counts the new movement, not the balance before it", async () => {
      // The whole point of settling after the write: reading the log first
      // would have left the receipt open on the strength of fuel it had just
      // given up.
      const { repo, update } = reconcileRepo([{ quantity: "30000", drawn: [] }], "2000");
      await repo.createReconciliation(out);
      const last = update.mock.calls.at(-1)?.[0] as { data?: { status?: string } };
      expect(last?.data?.status).toBe("stockOut");
    });
  });
});
