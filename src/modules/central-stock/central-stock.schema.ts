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

/**
 * The landing fees charged as the stock is received: what it cost to clear,
 * store and move this load. Each is charged from the fee catalogue and copies
 * its price at this moment, so a landed cost worked out today does not move
 * when the catalogue is edited tomorrow.
 *
 * Sent as a JSON array, since the form posts multipart (it carries the receipt
 * document): `fees=[{"feeTypeId":"…","count":2}]`.
 */
const feesField = z.union([z.string(), z.array(z.unknown())])
  // Optional here rather than on the array below: the key is usually absent,
  // and a union member of `z.undefined()` does not make a key optional.
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "fees must be a JSON array" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.object({
    feeTypeId: uuidSchema,
    /** How many times it is charged; 3 x a fixed fee, not a volume. */
    count: z.coerce.number().int().positive().max(10_000).default(1),
  })).max(50).optional());

export const createCentralStockSchema = z.object({
  deportId: uuidSchema,
  itemId:  uuidSchema,
  ambQuantity: z.coerce.number(),
  quantityAt20C: z.coerce.number(),
  receiptNumber: z.string(),
  supportingDocUrl: z.string().optional().nullable(),
  t1ValidationId: uuidSchema,
  status:  z.enum(CentralStockStatus).default("inStock").optional(),
  createdBy: uuidSchema,
  toleranceRate: z.coerce.number().optional(),
  lossQty: z.coerce.number().optional(),
  gainQty: z.coerce.number().optional(),
  /** What it cost to land this receipt. Left out when there is nothing to charge. */
  fees: feesField

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
