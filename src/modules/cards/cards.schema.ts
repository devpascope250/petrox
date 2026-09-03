import { z } from "zod";
import { CardType } from "../../../prisma/generated/prisma/enums.js";
import { pinSchema, uuidSchema } from "../../shared/validation/index.js";

const bigintIdSchema = z.coerce.bigint().positive("Id must be a positive integer");
const nullableText = z.string().trim().min(1).max(100).nullable().optional();
const balanceSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, "Invalid monetary amount"));

export const cardParamsSchema = z.object({ id: bigintIdSchema });

export const createCardSchema = z.object({
  cardNumber: nullableText,
  serialNumber: nullableText,
  cardCode: nullableText,
  balance: balanceSchema.optional(),
  availability: z.boolean().optional(),
  type: z.enum(CardType).nullable().optional(),
  securityCategory: z.number().int().min(1).max(2).nullable().optional(),
  state: z.number().int().min(0).max(2).optional(),
  swapStatus: z.number().int().nullable().optional(),
  inventoryStatus: z.number().int().min(1).max(3).nullable().optional()
}).strict();

export const updateCardSchema = createCardSchema.refine(
  (data) => Object.keys(data).length > 0,
  "At least one field is required"
);

export const createCardCopySchema = z.object({
  clientId: uuidSchema,
  cardId: bigintIdSchema,
  cardCopyId: bigintIdSchema.optional(),
  lastIndex: z.number().int().min(1).optional(),
  pin: pinSchema
}).strict().refine(
  (data) => data.cardCopyId === undefined || data.cardId !== data.cardCopyId,
  { path: ["cardCopyId"], message: "Copy card must be different from the main card" }
);

export const updateCardCopySchema = z.object({
  clientId: uuidSchema.optional(),
  lastIndex: z.number().int().min(1).optional(),
  pin: pinSchema.optional()
}).strict().refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const assignCopyCardSchema = z.object({
  cardCopyId: bigintIdSchema
}).strict();

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type CreateCardCopyInput = z.infer<typeof createCardCopySchema>;
export type UpdateCardCopyInput = z.infer<typeof updateCardCopySchema>;
