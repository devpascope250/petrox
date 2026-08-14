import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";
import { CentralStockStatus, StockTransactionType } from "../../../prisma/generated/prisma/enums.js";

export const createCentralStockSchema = z.object({
  deportId: uuidSchema,
  itemId:  uuidSchema,
  quantity: z.coerce.number(),
  supportingDocUrl: z.string().optional().nullable(),
  t1ValidationId: uuidSchema,
  status:  z.enum(CentralStockStatus).default("inStock").optional()
});

export const stockTransactionSchema = z.object({
  centralStockId: uuidSchema,
  quantity: z.coerce.number(),
  type: z.enum(StockTransactionType)
})

export type CreateCentralStockSchema = z.infer<typeof createCentralStockSchema>;
export type StockTransactionSchema = z.infer<typeof stockTransactionSchema>;