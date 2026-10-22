import { z } from "zod";
import { nonEmptyNameSchema, pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";
import { CargoStatus } from "../../../prisma/generated/prisma/enums.js";

/**
 * A page of the cargo list. The window applies to `receivedDate`, so asking
 * for a period returns that period a page at a time rather than all of it.
 */
export const cargoListQuerySchema = pagedDatesQuerySchema.extend({
  status: z.enum(CargoStatus).optional(),
  orderId: uuidSchema.optional(),
  deportId: uuidSchema.optional(),
  /** Matches a BL, TANSIS or outurn reference, or the vessel's name. */
  search: z.string().trim().max(100).optional(),
});

export type CargoListQuery = z.infer<typeof cargoListQuerySchema>;

export const createCargoSchema = z.object({
  deportId: nonEmptyNameSchema,
  orderId: nonEmptyNameSchema,
  vesselName: nonEmptyNameSchema,
  receivedDate: z.coerce.date(),
  expirationDate: z.coerce.date(),
  quantityInKg: z.coerce.number(),
  quantityInLitre: z.coerce.number(),
  blRef: nonEmptyNameSchema,
  supportingDocUrl: z.string().optional().nullable(),
  tansisRef: z.string().optional().nullable(),
  outurnRef: z.string().optional().nullable(),
});

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateCargoSchema = z.infer<typeof createCargoSchema>;
