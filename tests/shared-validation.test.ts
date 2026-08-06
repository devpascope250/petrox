import { describe, expect, it } from "vitest";
import { emailSchema, idParamsSchema, paginationQuerySchema, parseInput, pinSchema } from "../src/shared/validation/index.js";

describe("shared validation", () => {
  it("normalizes email addresses", () => {
    expect(parseInput(emailSchema, "  USER@Example.COM ")).toBe("user@example.com");
  });

  it("enforces numeric PIN boundaries", () => {
    expect(pinSchema.safeParse("1234").success).toBe(true);
    expect(pinSchema.safeParse("12ab").success).toBe(false);
    expect(pinSchema.safeParse("123456789").success).toBe(false);
  });

  it("coerces and limits pagination consistently", () => {
    expect(parseInput(paginationQuerySchema, { page: "2", pageSize: "50" })).toEqual({ page: 2, pageSize: 50 });
    expect(paginationQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it("validates resource identifiers", () => {
    expect(idParamsSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
