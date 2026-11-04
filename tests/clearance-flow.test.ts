import { describe, expect, it } from "vitest";
import {
  confirmClearancePaymentSchema,
  createStockClearanceSchema,
} from "../src/modules/stock clearance/clearance.schema.js";
import { clearanceDecisionSchema } from "../src/modules/stock clearance/authorizers/clearance-authorizer.schema.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const base = { type: "fifo" as const, itemId: uuid(1), quantity: "4000" };

describe("raising a clearance", () => {
  it("reads the taxes from the JSON string a multipart form sends", () => {
    const parsed = createStockClearanceSchema.parse({
      ...base,
      taxes: JSON.stringify([
        { taxId: uuid(2), amount: "120000" },
        { taxId: uuid(3), amount: 30000 },
      ]),
    });
    expect(parsed.taxes).toEqual([
      { taxId: uuid(2), amount: 120000 },
      { taxId: uuid(3), amount: 30000 },
    ]);
  });

  it("takes the taxes as an array too, for a service or a test", () => {
    const parsed = createStockClearanceSchema.parse({
      ...base,
      taxes: [{ taxId: uuid(2), amount: 1 }],
    });
    expect(parsed.taxes).toHaveLength(1);
  });

  it("treats an empty field as no tax at all", () => {
    expect(createStockClearanceSchema.parse({ ...base, taxes: "" }).taxes).toEqual([]);
    expect(createStockClearanceSchema.parse(base).taxes).toEqual([]);
  });

  it("refuses the same tax twice: the API would, and the total would double", () => {
    const result = createStockClearanceSchema.safeParse({
      ...base,
      taxes: [
        { taxId: uuid(2), amount: 1 },
        { taxId: uuid(2), amount: 2 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("has no amount to type: the total is the taxes added up", () => {
    const parsed = createStockClearanceSchema.parse({ ...base, amount: "999999" }) as Record<string, unknown>;
    expect(parsed.amount).toBeUndefined();
  });

  it("still requires a receipt for a manual clearance", () => {
    expect(createStockClearanceSchema.safeParse({ ...base, type: "manual" }).success).toBe(false);
    expect(
      createStockClearanceSchema.safeParse({ ...base, type: "manual", centralStockId: uuid(9) }).success,
    ).toBe(true);
  });
});

describe("deciding on a clearance", () => {
  it("takes an approval with no reason", () => {
    expect(clearanceDecisionSchema.parse({ decision: "approved" })).toEqual({ decision: "approved" });
  });

  it("refuses a rejection with no reason", () => {
    const result = clearanceDecisionSchema.safeParse({ decision: "rejected" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["reason"]);
  });

  it("takes a rejection with one", () => {
    expect(
      clearanceDecisionSchema.safeParse({ decision: "rejected", reason: "assessment missing" }).success,
    ).toBe(true);
  });
});

describe("confirming the payment", () => {
  it("requires the document: it is the proof", () => {
    expect(confirmClearancePaymentSchema.safeParse({}).success).toBe(false);
    expect(confirmClearancePaymentSchema.safeParse({ paymentDocUrl: "" }).success).toBe(false);
    expect(
      confirmClearancePaymentSchema.safeParse({ paymentDocUrl: "/uploads/receipt.pdf" }).success,
    ).toBe(true);
  });
});
