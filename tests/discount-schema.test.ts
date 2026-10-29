import { describe, expect, it } from "vitest";
import { createDiscountSchema } from "../src/modules/discounts/discount.schema.js";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const dates = { validFrom: "2026-09-01T00:00:00.000Z", validTo: "2026-09-30T00:00:00.000Z" };

describe("discount input validation", () => {
  it("requires clientId for a fixed discount", () => {
    expect(createDiscountSchema.safeParse({ type: "fixed", value: 10, ...dates }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ type: "fixed", value: 10, clientId: uuid, ...dates }).success).toBe(true);
  });

  it("requires ranges for a ranging discount", () => {
    expect(createDiscountSchema.safeParse({ type: "ranging", value: 0, ...dates }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ type: "ranging", value: 0, rangingDiscounts: [], ...dates }).success).toBe(false);
  });

  it("accepts valid non-overlapping ranges", () => {
    const result = createDiscountSchema.safeParse({
      type: "ranging", value: 0, ...dates,
      rangingDiscounts: [
        { from: 0, to: 100, rate: 2, siteId: uuid },
        { from: 100, to: 200, rate: 3, siteId: uuid }
      ]
    });
    expect(result.success).toBe(true);
  });

  it("rejects overlapping ranges at the same site", () => {
    const result = createDiscountSchema.safeParse({
      type: "ranging", value: 0, ...dates,
      rangingDiscounts: [
        { from: 0, to: 100, rate: 2, siteId: uuid },
        { from: 90, to: 200, rate: 3, siteId: uuid }
      ]
    });
    expect(result.success).toBe(false);
  });

  it("rejects a rate of more than 100, because it is a percentage", () => {
    expect(createDiscountSchema.safeParse({ type: "fixed", value: 100, clientId: uuid, ...dates }).success).toBe(true);
    expect(createDiscountSchema.safeParse({ type: "fixed", value: 150, clientId: uuid, ...dates }).success).toBe(false);
    expect(createDiscountSchema.safeParse({
      type: "ranging", value: 0, ...dates,
      rangingDiscounts: [{ from: 0, to: 100, rate: 101, siteId: uuid }]
    }).success).toBe(false);
  });

  it("rejects invalid validity dates", () => {
    expect(createDiscountSchema.safeParse({
      type: "fixed", value: 10, clientId: uuid,
      validFrom: dates.validTo, validTo: dates.validFrom
    }).success).toBe(false);
  });
});
