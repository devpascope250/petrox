import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createOrderSchema = z.object({
    supplierId: uuidSchema,
    orderDate:  z.coerce.date(),
    itemId:  uuidSchema,
    orderPlanId:  uuidSchema,
    quantity:   z.coerce.number(),
  });

export const createOrderPlanSchema = z.object({
    name:  nonEmptyNameSchema,
    startDate: z.coerce.date(),
    endDate:  z.coerce.date()
});

export type CreateOrderPlanSchema = z.infer<typeof createOrderPlanSchema>;

export type CreateOrderSchema = z.infer<typeof createOrderSchema>;