import { describe, expect, it } from "vitest";
import {
  createWalletMovementSchema,
  walletMovementDirection,
  walletMovementQuerySchema
} from "../src/modules/client-wallets/client-wallet.schema.js";

describe("wallet movement validation", () => {
  it("accepts and validates movement date filters", () => {
    const result = walletMovementQuerySchema.parse({
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-03T00:00:00.000Z"
    });
    expect(result.startDate).toBeInstanceOf(Date);
    expect(walletMovementQuerySchema.safeParse({
      startDate: "2026-08-04T00:00:00.000Z",
      endDate: "2026-08-03T00:00:00.000Z"
    }).success).toBe(false);
  });

  it("accepts positive amounts with at most two decimal places", () => {
    const result = createWalletMovementSchema.parse({
      type: "DEPOSIT",
      amount: "1250.50",
      accountId: "cjld2cjxh0000qzrmn831i7rn",
      referenceId: "DEP-001",
      supportingDocUrl: "/uploads/deposit.pdf"
    });
    expect(result.amount).toBe("1250.50");
  });

  it.each(["0", "-1", "1.001"])("rejects invalid amount %s", (amount) => {
    expect(createWalletMovementSchema.safeParse({
      type: "ADJUSTMENT",
      amount
    }).success).toBe(false);
  });

  it("rejects a direction supplied by the client", () => {
    expect(createWalletMovementSchema.safeParse({
      type: "WITHDRAWAL",
      direction: "IN",
      amount: "10"
    }).success).toBe(false);
  });

  it("derives transaction directions from movement types", () => {
    expect(walletMovementDirection.DEPOSIT).toBe("IN");
    expect(walletMovementDirection.REFUND).toBe("IN");
    expect(walletMovementDirection.WITHDRAWAL).toBe("OUT");
    expect(walletMovementDirection.PAYMENT).toBe("OUT");
    expect(walletMovementDirection.TRANSFER).toBe("OUT");
  });

  it.each(["accountId", "referenceId"])("requires %s for deposits", (field) => {
    const deposit: Record<string, string> = {
      type: "DEPOSIT",
      amount: "10",
      accountId: "cjld2cjxh0000qzrmn831i7rn",
      referenceId: "DEP-002",
      supportingDocUrl: "/uploads/deposit.pdf"
    };
    delete deposit[field];

    const result = createWalletMovementSchema.safeParse(deposit);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });

  it("requires an uploaded supporting document for deposits", () => {
    expect(createWalletMovementSchema.safeParse({
      type: "DEPOSIT",
      amount: "10",
      accountId: "cjld2cjxh0000qzrmn831i7rn",
      referenceId: "DEP-003"
    }).success).toBe(false);
  });

  it("rejects supporting documents for non-deposit movements", () => {
    expect(createWalletMovementSchema.safeParse({
      type: "REFUND",
      amount: "10",
      supportingDocUrl: "/uploads/refund.pdf"
    }).success).toBe(false);
  });
});
