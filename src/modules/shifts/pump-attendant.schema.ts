import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/**
 * An attendant working a pump during a site shift, and the nozzles of that
 * pump he handles. The site comes from the site shift, so it is never sent.
 *
 * Which days he works is not part of this: the time table (`TblTimeTable`)
 * rosters people onto shifts by date, and that is what the pump reads when a
 * sale is confirmed.
 */
export const createPumpAttendantSchema = z.object({
  siteShiftId: uuidSchema,
  pumpId: uuidSchema,
  userId: uuidSchema,
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle"),
});

export const pumpAttendantQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  siteShiftId: uuidSchema.optional(),
  pumpId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
});

export type CreatePumpAttendantSchema = z.infer<typeof createPumpAttendantSchema>;
export type PumpAttendantQuerySchema = z.infer<typeof pumpAttendantQuerySchema>;
