import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";
import { CentralStockStatus, StockStateStatus, StockTransactionType } from "../../../prisma/generated/prisma/enums.js";

export const centralStockReportQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(CentralStockStatus).optional(),
  itemId: uuidSchema.optional(),
  depotId: uuidSchema.optional(),
  // Keep this alias while the database and older clients use `deport`.
  deportId: uuidSchema.optional(),
}).refine(
  ({ depotId, deportId }) => !depotId || !deportId || depotId === deportId,
  { message: "depotId and deportId must refer to the same depot", path: ["depotId"] },
).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { message: "startDate must be before or equal to endDate", path: ["endDate"] },
);

export type CentralStockReportQuerySchema = z.infer<typeof centralStockReportQuerySchema>;

export const createCentralStockSchema = z.object({
  deportId: uuidSchema,
  itemId:  uuidSchema,
  quantity: z.coerce.number(),
  supportingDocUrl: z.string().optional().nullable(),
  t1ValidationId: uuidSchema,
  status:  z.enum(CentralStockStatus).default("inStock").optional(),
  createdBy: uuidSchema
});

export const stockTransactionSchema = z.object({
  centralStockId: uuidSchema,
  quantity: z.coerce.number().positive(),
  type: z.enum(StockTransactionType)
})

export const stockReconciliationsBodySchema = z.object({
  centralStockId: uuidSchema,
  quantity: z.coerce.number().positive(),
  reconciliationType: z.enum([StockTransactionType.reconcilliationIn, StockTransactionType.reconcilliationOut]),
  state: z.enum(StockStateStatus),
  createdBy: uuidSchema,
  note: z.string().optional(),
  supportingDocUrl: z.string().optional().nullable()
})

export type CreateCentralStockSchema = z.infer<typeof createCentralStockSchema>;
export type StockTransactionSchema = z.infer<typeof stockTransactionSchema>;
export type StockReconciliationsBodySchema = z.infer<typeof stockReconciliationsBodySchema>;
