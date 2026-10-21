import { describe, expect, it } from "vitest";
import { z } from "zod";
import { normalizeError } from "../src/utils/error-handler.js";

describe("validation error details", () => {
  it("formats nested objects and array indexes as form field paths", () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string().min(2, "Name is too short") }))
    });

    const result = schema.safeParse({ items: [{ name: "x" }] });
    if (result.success) throw new Error("Expected validation to fail");

    expect(normalizeError(result.error, "request-1").error.details).toEqual([
      { field: "items[0].name", code: "too_small", message: "Name is too short" }
    ]);
  });

  it("uses _root for object-level schema errors", () => {
    const result = z.object({ password: z.string(), confirmation: z.string() })
      .refine((value) => value.password === value.confirmation, "Passwords must match")
      .safeParse({ password: "one", confirmation: "two" });
    if (result.success) throw new Error("Expected validation to fail");

    expect(normalizeError(result.error, "request-2").error.details?.[0]).toMatchObject({
      field: "_root",
      message: "Passwords must match"
    });
  });
});

describe("a unique constraint conflict", () => {
  const conflict = (target: unknown) =>
    normalizeError({ code: "P2002", meta: { target } } as never, "request-3").error;

  it("names the column, whether the database reported the field or the index", () => {
    // MySQL reports the index's own name …
    expect(conflict("User_phone_key")).toMatchObject({
      statusCode: 409,
      code: "RESOURCE_CONFLICT",
      data: { fields: ["phone"] },
    });
    // … while other databases report the fields themselves.
    expect(conflict(["phone"]).data).toEqual({ fields: ["phone"] });
    // A compound index names each of its columns.
    expect(conflict("UserSites_userId_siteId_key").data).toEqual({ fields: ["userId", "siteId"] });
    // Anything that is not of that shape is passed on as it came.
    expect(conflict("PRIMARY").data).toEqual({ fields: ["PRIMARY"] });
  });
});
