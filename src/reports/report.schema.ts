import { z } from "zod";
import { CentralStockStatus, StockStateStatus, StockTransactionType } from "../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../shared/validation/index.js";

const reportDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const fromDate = reportDate.transform((value) => new Date(value));
const toDate = reportDate.transform((value) => new Date(
  value.length === 10 ? `${value}T23:59:59.999Z` : value,
));

export const reportOrderSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  bySupplierId: uuidSchema.optional(),
  byOrderPlanId: uuidSchema.optional(),
  orderCode: z.string().trim().min(1).optional(),
  itemId: uuidSchema.optional(),
  deportId: uuidSchema.optional(),
}).superRefine(({ startDate, endDate }, context) => {
  if (startDate && endDate && startDate > endDate) context.addIssue({ code: "custom", message: "startDate must be before or equal to endDate", path: ["endDate"] });
});

export const centralStockReportSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  centralStockId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  depotId: uuidSchema.optional(),
  status: z.enum(CentralStockStatus).optional(),
  clearanceStatus: z.enum(StockStateStatus).optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export const centralStockTransactionReportSchema = paginationQuerySchema.extend({
  startDate: fromDate.optional(),
  endDate: toDate.optional(),
  centralStockId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
  depotId: uuidSchema.optional(),
  type: z.enum(StockTransactionType).optional(),
  createdBy: uuidSchema.optional(),
}).refine(({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate, {
  message: "startDate must be before or equal to endDate", path: ["endDate"],
});

export type ReportOrderSchema = z.infer<typeof reportOrderSchema>;
export type CentralStockReportSchema = z.infer<typeof centralStockReportSchema>;
export type CentralStockTransactionReportSchema = z.infer<typeof centralStockTransactionReportSchema>;
export type ReportOrderQuery = Omit<ReportOrderSchema, "startDate" | "endDate"> & { startDate: Date; endDate: Date };
export type CentralStockReportQuery = Omit<CentralStockReportSchema, "startDate" | "endDate"> & { startDate: Date; endDate: Date };
export type CentralStockTransactionReportQuery = Omit<CentralStockTransactionReportSchema, "startDate" | "endDate"> & { startDate: Date; endDate: Date };
