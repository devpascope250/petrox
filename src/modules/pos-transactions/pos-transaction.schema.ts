import { z } from "zod";
import { GeneralTransactionStatus } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * What narrows the POS sales report. Dates are moments, not days: the browser
 * sends the start and end of the days picked in its own timezone.
 */
const filtersSchema = z.object({
  siteId: uuidSchema.optional(),
  status: z.enum(GeneralTransactionStatus).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  /** Matches the transaction code, plate number, client name or card number. */
  search: z.string().trim().max(100).optional(),
});

/** The dates have to be the right way round, whichever endpoint they reach. */
const inOrder = <T extends { startDate?: Date; endDate?: Date }>(value: T) =>
  !value.startDate || !value.endDate || value.startDate <= value.endDate;
const ORDER_MESSAGE = { message: "startDate must be before or equal to endDate", path: ["endDate"] };

export const posTransactionListQuerySchema = filtersSchema.extend(paginationQuerySchema.shape)
  .refine(inOrder, ORDER_MESSAGE);

/**
 * The same filters, without a page: the financial report covers everything
 * they match, so its figures and the screen's totals agree.
 */
export const posTransactionReportQuerySchema = filtersSchema.refine(inOrder, ORDER_MESSAGE);

export type PosTransactionListQuery = z.infer<typeof posTransactionListQuerySchema>;
export type PosTransactionReportQuery = z.infer<typeof posTransactionReportQuerySchema>;
