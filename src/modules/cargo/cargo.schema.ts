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

/**
 * A shipment going back to the supplier.
 *
 * `kind` says whether that is the end of it (`returned`) or a new shipment is
 * coming in its place (`replaced`) — the replacement is raised afterwards,
 * against the return, so the two are never half-linked.
 *
 * The whole shipment goes back or none of it: there is no quantity here.
 */
export const returnCargoSchema = z.object({
  kind: z.enum(["returned", "replaced"]),
  /** Required. "Why did 200,000 litres go back" is the point of the record. */
  reason: z.string().trim().min(1, "Say why the shipment went back").max(1000),
  /** What the supplier owes back, when that has been agreed. */
  refundAmount: z.coerce.number().nonnegative().optional(),
  currencyCode: z.string().trim().max(10).optional(),
  supportingDocUrl: z.string().optional().nullable(),
}).refine(
  (value) => value.refundAmount === undefined || Boolean(value.currencyCode),
  { message: "Say which currency the refund is in", path: ["currencyCode"] },
);

export type ReturnCargoSchema = z.infer<typeof returnCargoSchema>;

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateCargoSchema = z.infer<typeof createCargoSchema>;
