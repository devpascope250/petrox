import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";

/** "06:00", "22:30" — 24-hour clock. */
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour format HH:mm");

/**
 * A shift shared by every site, e.g. "Morning 06:00–14:00". `endAt` may be
 * earlier than `startAt`: that is a night shift running past midnight.
 */
export const createShiftSchema = z
  .object({
    name: nonEmptyNameSchema,
    startAt: timeSchema,
    endAt: timeSchema,
  })
  .refine((data) => data.startAt !== data.endAt, {
    message: "The shift must end at a different time than it starts",
    path: ["endAt"],
  });

/** What the forms need to fill their pickers, for one site. */
export const shiftOptionsQuerySchema = z.object({
  siteId: uuidSchema.optional(),
});

export type CreateShiftSchema = z.infer<typeof createShiftSchema>;
export type ShiftOptionsQuerySchema = z.infer<typeof shiftOptionsQuerySchema>;
