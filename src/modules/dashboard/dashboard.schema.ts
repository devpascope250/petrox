import { z } from "zod";

/** Without `startDate` the dashboard starts on 1 January of yesterday's year. It always ends yesterday. */
export const dashboardQuerySchema = z.object({
  startDate: z.iso.date("Must be a date like 2026-01-01").optional(),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
