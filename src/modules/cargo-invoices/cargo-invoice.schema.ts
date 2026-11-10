import { z } from "zod";
import { recordIdSchema, nonEmptyNameSchema } from "../../shared/validation/index.js";

export const createCargoInvoiceSchema = z.object({
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  amount: z.coerce.number().nonnegative(),
  currencyCode: nonEmptyNameSchema,
  cargoId: recordIdSchema,
  supportingDocUrl: z.string().startsWith("/uploads/").optional().nullable(),
  invoiceCode: nonEmptyNameSchema,
  invoiceReference: nonEmptyNameSchema,
});

export const updateCargoInvoiceSchema = createCargoInvoiceSchema.partial();

export type CreateCargoInvoiceInput = z.infer<typeof createCargoInvoiceSchema>;
export type UpdateCargoInvoiceInput = z.infer<typeof updateCargoInvoiceSchema>;