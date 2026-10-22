import { z } from "zod";
import {
  cuidSchema,
  nonEmptyNameSchema,
  uuidSchema,
} from "../../shared/validation/index.js";

/**
 * A PFI invoices a shipment, so it belongs to the **cargo** — not to the
 * nomination that later loads from it. Cargo ids are cuids.
 */
export const createPfiSchema = z.object({
  cargoId: cuidSchema,
  currencyId: uuidSchema,
  currancyCode: nonEmptyNameSchema,
  amount: z.coerce.number(),
  pfiReference: nonEmptyNameSchema,
  unitPrice: z.coerce.number(),
  supportingDocUrl: z.string().optional(),
  createdBy: z.string().optional()
});

export const createCurrancySchema = z.object({
  code: nonEmptyNameSchema,
  name: nonEmptyNameSchema,
  rate: z.coerce.number(),
});

export type CreateCurrancySchema = z.infer<typeof createCurrancySchema>;
export type CreatePfiSchema = z.infer<typeof createPfiSchema>;
