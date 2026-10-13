import { z } from "zod";
import { GeneralTransactionStatus } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * Filters for the POS sales report. Dates are moments, not days: the browser
 * sends the start and end of the days picked in its own timezone.
 */
export const posTransactionListQuerySchema = paginationQuerySchema.extend({
  siteId: uuidSchema.optional(),
  status: z.enum(GeneralTransactionStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  /** Matches the transaction code, plate number, client name or card number. */
  search: z.string().trim().max(100).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export type PosTransactionListQuery = z.infer<typeof posTransactionListQuerySchema>;
