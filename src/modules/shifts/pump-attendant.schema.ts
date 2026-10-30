import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/** "2026-11-02" — a calendar day, as the time table stores one. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

/**
 * Puts an attendant on a pump, with the nozzles of it he handles, **on each of
 * the days named** — one row per rostered day.
 *
 * The days are the point: the forecourt rotates, so the same person is on
 * another pump next week. Each day has to be one the **time table** already
 * rosters them on for that shift; a day it does not is reported back rather
 * than written, so the roster stays the one place that says who works when.
 *
 * `siteShiftId` and `userId` say which roster rows to look for. The site comes
 * from the shift, so it is never sent.
 */
export const createPumpAttendantSchema = z.object({
  siteShiftId: uuidSchema,
  userId: uuidSchema,
  pumpId: uuidSchema,
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle"),
  /** The working days to write it to — a week's worth at most. */
  dates: z.array(dateSchema).min(1, "Choose at least one day").max(31, "Choose at most 31 days"),
});

/**
 * Changing one day's assignment: its pump and the nozzles of it. The day and
 * the person are the roster row's, so a different day is a different row.
 */
export const updatePumpAttendantSchema = z.object({
  pumpId: uuidSchema,
  nozzleIds: z.array(uuidSchema).min(1, "Choose at least one nozzle"),
});

export const pumpAttendantQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  siteShiftId: uuidSchema.optional(),
  pumpId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  /** The week being looked at, as working days. */
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});

/**
 * Copies the pump assignments of the 7 days starting at `startDate` onto the 7
 * days after them, for the people the time table rosters there — the next
 * week's rota, in one move, as the time table itself can be copied.
 */
export const copyPumpAttendantWeekSchema = z.object({
  startDate: dateSchema,
  siteId: uuidSchema.optional(),
});

export type CreatePumpAttendantSchema = z.infer<typeof createPumpAttendantSchema>;
export type UpdatePumpAttendantSchema = z.infer<typeof updatePumpAttendantSchema>;
export type PumpAttendantQuerySchema = z.infer<typeof pumpAttendantQuerySchema>;
export type CopyPumpAttendantWeekSchema = z.infer<typeof copyPumpAttendantWeekSchema>;
