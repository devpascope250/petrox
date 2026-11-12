import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";

export const createT1ValidationsSchema = z.object({
  nominationId: uuidSchema,
  exportingCountry: nonEmptyNameSchema,
  customOffice:   nonEmptyNameSchema,
  // transitNumbering: nonEmptyNameSchema,
  quantityAt20C: z.coerce.number(),
  /**
   * The reference on the customs declaration this T1 was cleared under.
   * Optional: a trip may be recorded before its declaration comes back, and
   * every row entered before this field existed has none.
   */
  sdReference: z.string().trim().max(120).optional().transform((value) => value || null),
  supportingDocUrl: z.string().optional().nullable(),
  createdBy: z.string().optional()
});


export const createExtraT1ValidationsSchema = z.object({
  t1ValidationId: uuidSchema,
  customOffice:   nonEmptyNameSchema,
  transitNumbering: nonEmptyNameSchema,
});

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateT1ValidationsSchema = z.infer<typeof createT1ValidationsSchema>;
export type CreateExtraT1ValidationsSchema = z.infer<typeof createExtraT1ValidationsSchema>;