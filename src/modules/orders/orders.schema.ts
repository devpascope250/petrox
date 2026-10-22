import { z } from "zod";
import { nonEmptyNameSchema, pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A page of the orders list. `orderDate` is what the window applies to, so a
 * client asking for a month gets that month a page at a time.
 */
export const orderListQuerySchema = pagedDatesQuerySchema.extend({
  itemId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
  orderPlanId: uuidSchema.optional(),
  /** Matches an order code, a supplier or an item. */
  search: z.string().trim().max(100).optional(),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

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