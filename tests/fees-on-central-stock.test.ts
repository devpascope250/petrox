import { describe, expect, it } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { presentFees, sumFeeTotals } from "../src/modules/fees/fee.repository.js";
import { createCentralStockSchema } from "../src/modules/central-stock/central-stock.schema.js";

const dec = (value: number) => new Prisma.Decimal(value);
const UUID = "00000000-0000-4000-8000-0000000000";
const feeTypeId = `${UUID}01`;

const charge = (name: string, unitAmount: number, count: number, currencyCode = "RWF") => ({
  id: `${name}-id`, feeTypeId, name, count, unitAmount: dec(unitAmount), currencyCode,
  createdAt: new Date("2026-10-28T00:00:00.000Z"),
});

describe("a receipt's landing fees, as every report shows them", () => {
  it("gives each charge its line total and groups the totals by currency", () => {
    const presented = presentFees([charge("Clearing", 50_000, 2), charge("Storage", 60, 3, "USD")]);
    expect(presented.fees.map((fee) => [fee.name, fee.unitAmount, fee.lineTotal])).toEqual([
      ["Clearing", 50_000, 100_000],
      ["Storage", 60, 180],
    ]);
    // Never one total across two monies: that would be a wrong number.
    expect(presented.feeTotals).toEqual({ RWF: 100_000, USD: 180 });
    expect(presented.feeCount).toBe(2);
  });

  it("is an empty list and empty totals when nothing was charged", () => {
    // The same shape either way, so a report row never needs a missing-field test.
    expect(presentFees([])).toEqual({ fees: [], feeTotals: {}, feeCount: 0 });
  });

  it("counts a line to the cent", () => {
    expect(presentFees([charge("Odd", 10.33, 3)]).feeTotals).toEqual({ RWF: 30.99 });
  });
});

describe("rolling landing fees up for a summary", () => {
  it("adds each currency on its own", () => {
    expect(sumFeeTotals([{ RWF: 100_000, USD: 180 }, { RWF: 1_500 }, { USD: 20.5 }])).toEqual({
      RWF: 101_500,
      USD: 200.5,
    });
  });

  it("is an empty object when nothing was charged anywhere", () => {
    expect(sumFeeTotals([{}, {}])).toEqual({});
  });

  it("does not drift when many small amounts are added", () => {
    expect(sumFeeTotals(Array.from({ length: 10 }, () => ({ RWF: 0.1 })))).toEqual({ RWF: 1 });
  });
});

describe("fees charged as central stock is received", () => {
  const receipt = {
    deportId: `${UUID}02`,
    itemId: `${UUID}03`,
    ambQuantity: "30000",
    quantityAt20C: "29500",
    receiptNumber: "R-1",
    t1ValidationId: `${UUID}04`,
    createdBy: `${UUID}05`,
  };

  it("takes the fees as a JSON array, since the form posts multipart", () => {
    const parsed = createCentralStockSchema.parse({
      ...receipt,
      fees: JSON.stringify([{ feeTypeId, count: "2" }]),
    });
    expect(parsed.fees).toEqual([{ feeTypeId, count: 2 }]);
  });

  it("takes a real array too, for a JSON body", () => {
    expect(createCentralStockSchema.parse({ ...receipt, fees: [{ feeTypeId }] }).fees)
      .toEqual([{ feeTypeId, count: 1 }]);
  });

  it("records a receipt with no fees at all", () => {
    expect(createCentralStockSchema.parse(receipt).fees).toBeUndefined();
    // An empty field is "none", not a malformed array.
    expect(createCentralStockSchema.parse({ ...receipt, fees: "" }).fees).toBeUndefined();
  });

  it("refuses something that is not a JSON array", () => {
    const parsed = createCentralStockSchema.safeParse({ ...receipt, fees: "Clearing, Storage" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a count of zero: leaving the fee out is how it is not charged", () => {
    expect(createCentralStockSchema.safeParse({ ...receipt, fees: [{ feeTypeId, count: 0 }] }).success)
      .toBe(false);
  });
});
