import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import {
  nonEmptyNameSchema,
  pagedDatesQuerySchema,
  uuidSchema,
} from "../../shared/validation/index.js";

/** A page of the fee catalogue. */
export const feeTypeListQuerySchema = pagedDatesQuerySchema.extend({
  status: z.enum(StatusType).optional(),
  search: z.string().trim().max(100).optional(),
});

export const createFeeTypeSchema = z.object({
  name: nonEmptyNameSchema,
  /** What it costs now. Every charge keeps its own copy of this. */
  amount: z.coerce.number().nonnegative(),
  currencyCode: z.string().trim().min(2).max(10).default("RWF"),
  status: z.enum(StatusType).optional(),
});

/**
 * The fees charged against one record, as the whole set: what is sent replaces
 * what is there. A set is easier to reason about than a pile of add and remove
 * calls, and it matches how the form works — tick the fees, give each a count.
 */
export const assignFeesSchema = z.object({
  fees: z
    .array(
      z.object({
        feeTypeId: uuidSchema,
        /** How many times it is charged; 3 × a fixed fee, not a volume. */
        count: z.coerce.number().int().positive().max(10_000).default(1),
      }),
    )
    .max(50),
});

export const stockParamsSchema = z.object({ stockId: uuidSchema });
export const pfiParamsSchema = z.object({ pfiId: uuidSchema });

export type FeeTypeListQuery = z.infer<typeof feeTypeListQuerySchema>;
export type CreateFeeTypeSchema = z.infer<typeof createFeeTypeSchema>;
export type AssignFeesSchema = z.infer<typeof assignFeesSchema>;
