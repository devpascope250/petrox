import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/** "2026-10-05" — a calendar day. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

/**
 * One person rostered on a site shift for one date. `days` (the weekday) and
 * the site come from the date and the site shift, so neither is sent.
 * `extraShift` marks a shift worked on top of the normal roster.
 *
 * `isChief` / `isSuport` name the shift's chief and supporter for that date.
 * A person is one or the other, never both; and each shift has at most one of
 * each per date, so giving a role to someone takes it from whoever held it.
 */
export const createTimeTableSchema = z
  .object({
    siteShiftId: uuidSchema,
    userId: uuidSchema,
    dateOn: dateSchema,
    extraShift: z.boolean().default(false),
    isChief: z.boolean().default(false),
    isSuport: z.boolean().default(false),
  })
  .refine((data) => !(data.isChief && data.isSuport), {
    message: "A person cannot be chief and supporter at the same time",
    path: ["isSuport"],
  });

/** 0 = planned, 1 = present, 2 = absent. */
export const TIME_TABLE_STATUSES = [0, 1, 2] as const;

export const timeTableStatusSchema = z.object({
  status: z.coerce
    .number()
    .int()
    .refine((value) => (TIME_TABLE_STATUSES as readonly number[]).includes(value), "Status must be 0 (planned), 1 (present) or 2 (absent)"),
});

/** The role someone holds on a shift for a date; `none` takes it away. */
export const TIME_TABLE_ROLES = ["chief", "supporter", "none"] as const;

export const timeTableRoleSchema = z.object({
  role: z.enum(TIME_TABLE_ROLES),
});

/**
 * Copies the 7 days starting at `startDate` onto the 7 days after them — the
 * same people, shifts and roles, one week later. `siteId` narrows it to a site.
 */
export const copyTimeTableWeekSchema = z.object({
  startDate: dateSchema,
  siteId: uuidSchema.optional(),
});

export const timeTableQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  siteShiftId: uuidSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
});

export type CreateTimeTableSchema = z.infer<typeof createTimeTableSchema>;
export type TimeTableStatusSchema = z.infer<typeof timeTableStatusSchema>;
export type TimeTableRoleSchema = z.infer<typeof timeTableRoleSchema>;
export type TimeTableQuerySchema = z.infer<typeof timeTableQuerySchema>;
export type CopyTimeTableWeekSchema = z.infer<typeof copyTimeTableWeekSchema>;
