import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import { uuidSchema } from "../../shared/validation/index.js";

/** 1 = Monday … 7 = Sunday, as the time table counts weekdays. */
export const weekdaySchema = z.coerce.number().int().min(1, "Choose a day").max(7, "Choose a day");

/**
 * The standing arrangement: which pump an attendant works, and its nozzles, on
 * a weekday of a shift.
 *
 * It says what *usually* happens. Rostering someone on a date writes the pump
 * assignment for that date from the plan matching its weekday — which is why
 * the time table needs nothing but the pompist, the day and the shift.
 */
export const createPumpPlanSchema = z.object({
  siteShiftId: uuidSchema,
  userId: uuidSchema,
  pumpId: uuidSchema,
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle"),
  /** The weekdays this arrangement holds on — one plan written for each. */
  weekdays: z.array(weekdaySchema).min(1, "Choose at least one day").max(7),
  status: z.enum(StatusType).default(StatusType.active),
  /**
   * Also write it onto the days already rostered, from today onward. Left out,
   * the plan only applies to roster entries made after it.
   */
  applyToRostered: z.boolean().default(false),
}).strict();

/** Changing one plan: its pump, its nozzles, its weekday, whether it still holds. */
export const updatePumpPlanSchema = z.object({
  pumpId: uuidSchema.optional(),
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle").optional(),
  weekday: weekdaySchema.optional(),
  status: z.enum(StatusType).optional(),
  applyToRostered: z.boolean().default(false),
}).strict();

export const pumpPlanQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  siteShiftId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  pumpId: uuidSchema.optional(),
  weekday: weekdaySchema.optional(),
  status: z.enum(StatusType).optional(),
});

export type CreatePumpPlanSchema = z.infer<typeof createPumpPlanSchema>;
export type UpdatePumpPlanSchema = z.infer<typeof updatePumpPlanSchema>;
export type PumpPlanQuerySchema = z.infer<typeof pumpPlanQuerySchema>;
