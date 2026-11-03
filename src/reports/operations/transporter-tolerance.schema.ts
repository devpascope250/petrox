import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

const reportDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const fromDate = reportDate.transform((value) => new Date(value));
const toDate = reportDate.transform((value) => new Date(
  value.length === 10 ? `${value}T23:59:59.999Z` : value,
));

/**
 * Which trips the tolerance report covers. The days are matched against **when
 * the load was received** — the moment the difference became known — not when
 * it was nominated or cleared.
 *
 * The trips are paged; the totals by transporter always cover everything the
 * filters match, so the figures on screen never depend on the page.
 */
export const transporterToleranceReportSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  transporterId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  deportId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  /** On: only the trips outside the allowance. Off: only those inside it. */
  overTolerance: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export type TransporterToleranceReportSchema = z.infer<typeof transporterToleranceReportSchema>;
