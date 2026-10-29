import { z } from "zod";
import { GeneralTransactionStatus } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/** The sales no client account paid for: a walk-in at the pump. */
export const WALK_IN = "none";

/**
 * A yes/no filter. A query string sends the word, so `z.coerce.boolean()` is
 * no use — it reads `"false"` as true — and both forms are spelled out, as the
 * car form's flags are.
 */
const flagSchema = z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional();

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
  /** One client's sales, or `none` for the sales nobody's account paid for. */
  clientId: z.union([uuidSchema, z.literal(WALK_IN)]).optional(),
  /** On: only the sales carrying a discount. Off: only those without one. */
  hasDiscount: flagSchema,
  /** On: only the sales carrying a subsidy. Off: only those without one. */
  hasSubsidy: flagSchema,
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
