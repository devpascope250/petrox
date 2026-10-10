import { z } from "zod";
import { nonEmptyNameSchema, paginationQuerySchema, uuidSchema} from "../../shared/validation/index.js";

export const cuveStockQuerySchema = z.object({
  siteId: uuidSchema.optional(),
});

const reportDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const cuveTransactionsQuerySchema = paginationQuerySchema.extend({
  startDate: reportDate.transform((value) => new Date(value)).optional(),
  endDate: reportDate.transform((value) => new Date(
    value.length === 10 ? `${value}T23:59:59.999Z` : value,
  )).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

/** With no dates the inventory covers the whole history, so opening is zero. */
export const cuveInventoryQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  startDate: reportDate.transform((value) => new Date(value)).optional(),
  endDate: reportDate.transform((value) => new Date(
    value.length === 10 ? `${value}T23:59:59.999Z` : value,
  )).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export type CuveInventoryQuery = z.infer<typeof cuveInventoryQuerySchema>;
export type CuveStockQuery = z.infer<typeof cuveStockQuerySchema>;
export type CuveTransactionsQuery = z.infer<typeof cuveTransactionsQuerySchema>;

export const createCuveSchema = z.object({
    name: nonEmptyNameSchema,
    itemId: uuidSchema,
    minimum: z.coerce.number("Minimum must be a number"),
    maximum: z.coerce.number("Maximum must be a number"),
    deadStock: z.coerce.number("Dead stock must be a number"),
    siteId: uuidSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreateCuveSchema = z.infer<typeof createCuveSchema>;
