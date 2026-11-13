import { z } from "zod";
import { nonEmptyNameSchema, pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * One page of T1 validations in a window.
 *
 * `search` is matched against the **ship** the fuel came in on
 * (`Cargo.vesselName`) and its BL, the declaration reference, the exporting
 * country, and the trip's driver, plate, trailer and destination. A T1 is
 * recognised by its vessel more than by anything else, which is why the search
 * reaches two relations down to find it.
 */
export const t1ListQuerySchema = pagedDatesQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});

export type T1ListQuery = z.infer<typeof t1ListQuerySchema>;

export const createT1ValidationsSchema = z.object({
  nominationId: uuidSchema,
  exportingCountry: nonEmptyNameSchema,
  customOffice:   nonEmptyNameSchema,
  // transitNumbering: nonEmptyNameSchema,
  quantityAt20C: z.coerce.number(),
  /**
   * The shipment this T1's fuel came off, for reference.
   *
   * **It changes no arithmetic.** The litres are drawn from the batches the
   * nomination names, apportioned across them as always; this only records
   * which vessel the load is said to have come from, so a T1 loaded off a
   * different cargo than the trip drew on can be seen rather than inferred.
   *
   * Optional, and emptied rather than stored blank when the form sends "".
   */
  cargoId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => value || null),
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