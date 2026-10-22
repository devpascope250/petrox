import { z } from "zod";
import { CargoStatus, ExtraT1ValidationStatus, PlanStatus, StockStatus } from "../../../prisma/generated/prisma/enums.js";

export const uuidSchema = z.uuid("Must be a valid UUID");
export const cuidSchema = z.cuid2("Must be a valid CUID");
export const emailSchema = z.string()
  .trim()
  .pipe(z.email("Must be a valid email address"))
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string()
  .min(8, "Must contain at least 8 characters")
  .max(128, "Must contain at most 128 characters");
export const pinSchema = z.string()
  .regex(/^\d{4,8}$/, "Must contain between 4 and 8 digits");
export const opaqueTokenSchema = z.string()
  .min(32, "Token is invalid")
  .max(512, "Token is invalid");
export const querySearchOrderSupplierPlanSchema = z.object({
  supplierId: z.uuid().optional(),
  planId: z.uuid().optional()
}) 

export const assignDriverVehicleParams = z.object({
  vehicleId: z.uuid(),
  driverId: z.uuid()
});

export const datesQuerySchema = z.object({
  startDate:  z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
})

export const itemIdQuerySchema = z.object(
  {
    itemId: uuidSchema.optional()
  }
);

export const nonEmptyNameSchema = z.string().trim().min(1).max(80);
/**
 * A phone number kept in one shape, so the same number is always the same
 * text. `User.phone` is unique, but an index compares strings: without this,
 * `+250 788 123 456`, `0788-123-456` and `0788123456` are three different
 * numbers to the database and all three can be stored side by side.
 *
 * Spaces, dashes, dots and brackets are dropped, and a Rwandan number written
 * `+250…` or `250…` becomes the local `07…`. Anything else is only compacted.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => {
    const compact = value.replace(/[\s().\-]/g, "");
    const rwanda = /^(?:\+?250)(7\d{8})$/.exec(compact);
    return rwanda ? `0${rwanda[1]}` : compact;
  })
  .pipe(z.string().min(3).max(30));

export const idParamsSchema = z.object({ id: uuidSchema });
export const id2ParamsSchema = z.object({ id2: uuidSchema });
export const cuidParamsSchema = z.object({ id: cuidSchema });
export const cargoStatusPamasSchema = z.object({status: z.enum(CargoStatus)})
export const t1ExtraStatusPamasSchema = z.object({status: z.enum(ExtraT1ValidationStatus)})
export const cargoReceivedDatePamasSchema = z.object({date: z.coerce.date()})
export const stockStatusPamasSchema = z.object({status: z.enum(StockStatus)})
export const planStatusParamsSchema = z.object({status: z.enum(PlanStatus) });
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * A page of a list narrowed to a date window — what every growing list takes.
 * A date filter alone is not enough: a wide window still returns everything in
 * it, so the page is asked for in the same query.
 */
export const pagedDatesQuerySchema = paginationQuerySchema.extend({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type PagedDatesQuery = z.infer<typeof pagedDatesQuerySchema>;
export type DatesQuerySchema = z.infer<typeof datesQuerySchema>;
