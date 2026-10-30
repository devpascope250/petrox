import { z } from "zod";
import { pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A meter reading, `DECIMAL(18, 2)`: at most 16 integer digits and 2 decimal
 * places, which is more than any totaliser holds. Never negative — a counter
 * does not run backwards.
 */
const indexSchema = (label: string) => z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
    `${label} must have at most 16 integer digits and 2 decimal places`));

/** A calendar day, "YYYY-MM-DD": `dateOn` is a DATE column. */
const daySchema = z.iso.date("Must be a date like 2026-10-05");

/**
 * Recording a nozzle's meter at the close of a shift.
 *
 * Only `endIndex` is typed: the pump, the product, the site and `startIndex`
 * are all read from the nozzle and the reading before it, so nothing the POS
 * or the form sends can break the chain. `startIndex` is accepted **for the
 * first reading on a nozzle only** — the counter as it stood when the station
 * started recording — and ignored with a refusal after that. `sellingPrice`
 * defaults to the price in force for the product.
 */
export const createPumpIndexSchema = z.object({
  nozzleId: uuidSchema,
  shiftSiteId: uuidSchema,
  dateOn: daySchema,
  endIndex: indexSchema("End index"),
  /** The opening reading, for the first one on a nozzle. */
  startIndex: indexSchema("Start index").optional(),
  sellingPrice: indexSchema("Selling price").optional(),
}).strict();

/**
 * Correcting a reading that has **not** been approved. The nozzle it belongs
 * to never changes — that would move it to another chain — so a reading filed
 * against the wrong nozzle is left unapproved and recorded again where it
 * belongs.
 */
export const updatePumpIndexSchema = z.object({
  shiftSiteId: uuidSchema.optional(),
  dateOn: daySchema.optional(),
  endIndex: indexSchema("End index").optional(),
  /** Only while this is the first reading on its nozzle. */
  startIndex: indexSchema("Start index").optional(),
  sellingPrice: indexSchema("Selling price").optional(),
}).strict()
  .refine((input) => Object.values(input).some((value) => value !== undefined), "At least one field is required");

/**
 * Which readings to list. `startDate`/`endDate` are working days, matched
 * against `dateOn` rather than when the row was typed.
 */
export const pumpIndexListQuerySchema = pagedDatesQuerySchema.extend({
  siteId: uuidSchema.optional(),
  pumpId: uuidSchema.optional(),
  nozzleId: uuidSchema.optional(),
  shiftSiteId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  /** On: approved only. Off: still awaiting approval. */
  approved: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
});

/**
 * What a new reading on a nozzle would open at: the figure the form shows
 * before anything is typed, so nobody has to look up the last shift's close.
 */
export const pumpIndexOpeningQuerySchema = z.object({ nozzleId: uuidSchema });

export type CreatePumpIndexInput = z.infer<typeof createPumpIndexSchema>;
export type UpdatePumpIndexInput = z.infer<typeof updatePumpIndexSchema>;
export type PumpIndexListQuery = z.infer<typeof pumpIndexListQuerySchema>;
export type PumpIndexOpeningQuery = z.infer<typeof pumpIndexOpeningQuerySchema>;
