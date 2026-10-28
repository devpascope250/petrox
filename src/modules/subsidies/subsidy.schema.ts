import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import { pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A rate paid towards each unit sold. `Subsidy.rate` is `DECIMAL(12, 2)`, so
 * at most 10 integer digits and 2 decimal places — anything longer would be
 * rounded away silently.
 */
const rateSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/,
    "Rate must have at most 10 integer digits and 2 decimal places"))
  .refine((value) => Number(value) > 0, "Rate must be greater than zero");

/** A calendar day, "YYYY-MM-DD": `from` and `to` are DATE columns. */
const daySchema = z.iso.date("Must be a date like 2026-10-05");

const subsidyBody = {
  itemId: uuidSchema,
  /** Left out for a subsidy that applies at every site. */
  siteId: uuidSchema.optional(),
  rate: rateSchema,
  from: daySchema,
  to: daySchema,
  status: z.enum(StatusType).default(StatusType.active),
  note: z.string().trim().max(190, "Keep the note under 190 characters").optional(),
};

export const createSubsidySchema = z.object(subsidyBody).strict()
  .refine((subsidy) => subsidy.from <= subsidy.to, {
    path: ["to"], message: "To must be the same day as From or later",
  });

export const updateSubsidySchema = createSubsidySchema;

/**
 * Which subsidies to list. `startDate`/`endDate` match subsidies whose period
 * **overlaps** the window asked for, not ones that start inside it: a subsidy
 * that began last month and still runs is in force today and belongs in
 * today's list.
 */
export const subsidyListQuerySchema = pagedDatesQuerySchema.extend({
  itemId: uuidSchema.optional(),
  /** A site id, or "none" for subsidies that apply at every site. */
  siteId: z.union([uuidSchema, z.literal("none")]).optional(),
  status: z.enum(StatusType).optional(),
});

export const subsidyParamsSchema = z.object({ id: uuidSchema });

/** The subsidy in force for a product right now, if any. */
export const activeSubsidyQuerySchema = z.object({
  itemId: uuidSchema,
  siteId: uuidSchema.optional(),
});

export type CreateSubsidyInput = z.infer<typeof createSubsidySchema>;
export type UpdateSubsidyInput = z.infer<typeof updateSubsidySchema>;
export type SubsidyListQuery = z.infer<typeof subsidyListQuerySchema>;
export type ActiveSubsidyQuery = z.infer<typeof activeSubsidyQuerySchema>;
