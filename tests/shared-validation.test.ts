import { describe, expect, it } from "vitest";
import { emailSchema, idParamsSchema, paginationQuerySchema, parseInput, phoneSchema, pinSchema } from "../src/shared/validation/index.js";

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

describe("phoneSchema", () => {
  it("writes the same number the same way, so a unique index can see it is the same", () => {
    const parse = (value: string) => phoneSchema.parse(value);
    // Every spelling of one Rwandan mobile ends up as the local form.
    for (const written of ["0788123456", "0788 123 456", "0788-123-456", "+250788123456",
                           "+250 788 123 456", "250788123456", " (0788) 123.456 "]) {
      expect(parse(written)).toBe("0788123456");
    }
  });

  it("only compacts a number it does not recognise, and still bounds the length", () => {
    expect(phoneSchema.parse("+32 470 00 00 00")).toBe("+32470000000");
    expect(phoneSchema.parse("  123  ")).toBe("123");
    expect(phoneSchema.safeParse("12").success).toBe(false);
    expect(phoneSchema.safeParse("0".repeat(31)).success).toBe(false);
    // Spaces are not padding: a number of spaces is not a number.
    expect(phoneSchema.safeParse("     ").success).toBe(false);
  });
});
