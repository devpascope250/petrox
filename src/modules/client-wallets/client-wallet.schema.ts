import { z } from "zod";
import {
  WalletTransactionDirectionType,
  WalletTransactionType
} from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

export const clientWalletParamsSchema = z.object({
  id: z.cuid("Client wallet id must be a valid CUID")
});

export const walletMovementQuerySchema = paginationQuerySchema.extend({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
}).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { path: ["endDate"], message: "Start date must be before or equal to end date" }
);

export const createClientWalletSchema = z.object({
  clientId: uuidSchema
}).strict();

export const updateClientWalletSchema = z.object({
  clientId: uuidSchema
}).strict();

const walletAmountSchema = z.union([z.string(), z.number()])
  .transform((value) => String(value))
  .pipe(z.string().regex(
    /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
    "Amount must be a positive monetary value with at most 2 decimal places"
  ))
  .refine((value) => !/^0(?:\.0{1,2})?$/.test(value), "Amount must be greater than zero");

export const transferWalletToCardSchema = z.object({
  cardId: z.string().regex(/^[1-9]\d*$/, "Card id must be a positive integer").transform(BigInt),
  amount: walletAmountSchema
}).strict();

export const buyWalletCouponsSchema = z.object({
  couponPlanId: uuidSchema,
  quantity: z.number().int().min(1).max(100).default(1)
}).strict();

export type TransferWalletToCardInput = z.infer<typeof transferWalletToCardSchema>;
export type BuyWalletCouponsInput = z.infer<typeof buyWalletCouponsSchema>;

export const createWalletMovementSchema = z.object({
  type: z.enum(WalletTransactionType),
  amount: walletAmountSchema,
  accountId: z.cuid2("Company account id must be a valid CUID").optional(),
  referenceId: z.string().trim().min(1).max(100).optional(),
  supportingDocUrl: z.string().optional()
}).strict().superRefine((input, context) => {
  if (input.type === WalletTransactionType.DEPOSIT) {
    if (!input.accountId) {
      context.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "Company account is required for a deposit"
      });
    }
    if (!input.referenceId) {
      context.addIssue({
        code: "custom",
        path: ["referenceId"],
        message: "Reference is required for a deposit"
      });
    }
    if (!input.supportingDocUrl) {
      context.addIssue({
        code: "custom",
        path: ["supportingDocUrl"],
        message: "A supporting document is required for a deposit"
      });
    }
  } else if (input.supportingDocUrl) {
    context.addIssue({
      code: "custom",
      path: ["supportingDocUrl"],
      message: "Supporting documents are only accepted for deposits"
    });
  }
});

export const walletMovementDirection = {
  DEPOSIT: WalletTransactionDirectionType.IN,
  PAYMENT: WalletTransactionDirectionType.OUT,
  REFUND: WalletTransactionDirectionType.IN,
  LOAN: WalletTransactionDirectionType.IN,
  WITHDRAWAL: WalletTransactionDirectionType.OUT,
  TRANSFER: WalletTransactionDirectionType.OUT,
  ADJUSTMENT: WalletTransactionDirectionType.IN
} satisfies Record<WalletTransactionType, WalletTransactionDirectionType>;

export type CreateClientWalletInput = z.infer<typeof createClientWalletSchema>;
export type UpdateClientWalletInput = z.infer<typeof updateClientWalletSchema>;
export type CreateWalletMovementInput = z.infer<typeof createWalletMovementSchema>;
export type WalletMovementQuery = z.infer<typeof walletMovementQuerySchema>;
