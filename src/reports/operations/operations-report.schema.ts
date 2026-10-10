import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

const reportDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const fromDate = reportDate.transform((value) => new Date(value));
const toDate = reportDate.transform((value) => new Date(
  value.length === 10 ? `${value}T23:59:59.999Z` : value,
));

export const procurementOrderStatuses = ["ordered", "inTransit", "partiallyReceived", "received"] as const;
export const invoiceStatuses = ["notInvoiced", "partiallyInvoiced", "invoiced"] as const;

export const procurementOrderReportSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  supplierId: uuidSchema.optional(),
  orderPlanId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  deportId: uuidSchema.optional(),
  orderCode: z.string().trim().min(1).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export const depotStockMovementReportSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  depotId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  interval: z.enum(["day", "month", "period"]).default("day"),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export type ProcurementOrderReportSchema = z.infer<typeof procurementOrderReportSchema>;
export type DepotStockMovementReportSchema = z.infer<typeof depotStockMovementReportSchema>;
export type ProcurementOrderReportQuery = Omit<ProcurementOrderReportSchema, "startDate" | "endDate"> & { startDate: Date; endDate: Date };
export type DepotStockMovementReportQuery = Omit<DepotStockMovementReportSchema, "startDate" | "endDate"> & { startDate: Date; endDate: Date };
