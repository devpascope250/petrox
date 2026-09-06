import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

export const createItemToleranceRateSchema = z.object({
  maxRate: z.coerce.number().nonnegative(),
  itemId: uuidSchema,
});

export const updateItemToleranceRateSchema = createItemToleranceRateSchema.partial();

export type CreateItemToleranceRateInput = z.infer<typeof createItemToleranceRateSchema>;
export type UpdateItemToleranceRateInput = z.infer<typeof updateItemToleranceRateSchema>;
