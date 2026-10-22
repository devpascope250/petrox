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

/**
 * The PFI a cargo is recorded with. A shipment is invoiced by the supplier as
 * it arrives, so the two are raised together; every field is required once any
 * one of them is given, and leaving them all out records the cargo alone. More
 * PFIs can be added to the cargo afterwards.
 */
export const cargoPfiSchema = z.object({
  currencyId: uuidSchema,
  currancyCode: nonEmptyNameSchema,
  pfiReference: nonEmptyNameSchema,
  unitPrice: z.coerce.number().positive(),
  amount: z.coerce.number().positive(),
  supportingDocUrl: z.string().optional().nullable(),
});

export type CargoPfiSchema = z.infer<typeof cargoPfiSchema>;

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
  /** Sent as JSON under multipart, or as an object in a JSON body. */
  pfi: z.preprocess((value) => {
    // A form that sends the block untouched sends an empty string, which means
    // "no PFI" — `optional()` has to sit inside, or the blank is still parsed.
    if (typeof value !== "string") return value;
    if (value.trim() === "") return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, cargoPfiSchema.optional()),
});

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateCargoSchema = z.infer<typeof createCargoSchema>;
