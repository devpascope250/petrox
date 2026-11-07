import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";

export const createSupplierSchema = z.object({
    name: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    address: z.string().optional().nullable(),
    tinNumber: z.string().optional().nullable(),
    /**
     * Who to ask for when you call. Optional, and blank is stored as nothing
     * rather than an empty string, so "has a contact" is one check.
     */
    contactPerson: z.string().trim().max(120).optional().nullable()
      .transform((value) => value || null),
    /**
     * Where to write to them. Optional — a supplier sells fuel whether or not
     * anyone has their address — and validated when given, because a typo in
     * an address is only ever discovered by a mail that never arrives.
     */
    email: z.email("Enter a valid email address").optional().nullable()
      .or(z.literal("").transform(() => null))
      .transform((value) => value || null),
    /**
     * The path their paperwork — contract, licence, registration — was stored
     * at. **Left out, it is left alone**: an edit that sends no document keeps
     * the one already on file, which is why this is `undefined`-able rather
     * than nullable. It is set from the uploaded file, not taken from the
     * client; see `readSupplierUpload`.
     */
    documentUrl: z.string().trim().max(500).optional(),
    supplierTypeId: nonEmptyNameSchema
  });

export const createSupplierTypeSchema = z.object({
    type: nonEmptyNameSchema
});

export type CreateSupplierTypeSchema = z.infer<typeof createSupplierTypeSchema>;

export type CreateSupplierSchema = z.infer<typeof createSupplierSchema>;
