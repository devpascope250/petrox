import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/** Day of the week: 1 = Monday … 7 = Sunday. */
export const dayOfWeekSchema = z.coerce.number().int().min(1, "Day must be 1 (Mon) to 7 (Sun)").max(7, "Day must be 1 (Mon) to 7 (Sun)");

/**
 * An attendant working a pump during a site shift, on one day of the week, and
 * the nozzles of that pump he handles. The site comes from the site shift, so
 * it is never sent.
 */
export const createPumpAttendantSchema = z.object({
  siteShiftId: uuidSchema,
  pumpId: uuidSchema,
  userId: uuidSchema,
  day: dayOfWeekSchema,
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle"),
});

export const pumpAttendantQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  siteShiftId: uuidSchema.optional(),
  day: dayOfWeekSchema.optional(),
});

export type CreatePumpAttendantSchema = z.infer<typeof createPumpAttendantSchema>;
export type PumpAttendantQuerySchema = z.infer<typeof pumpAttendantQuerySchema>;
