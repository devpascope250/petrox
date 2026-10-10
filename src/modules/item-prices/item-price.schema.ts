import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

const priceSchema = z.coerce.number("Price must be a number").positive("Price must be more than zero");

export const createItemPriceSchema = z.object({
  /** The item and the unit it is priced in (`ItemUnit`). */
  itemUnitId: uuidSchema,
  price: priceSchema,
});

export const updateItemPriceSchema = z.object({
  itemUnitId: uuidSchema.optional(),
  price: priceSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export type CreateItemPrice = z.infer<typeof createItemPriceSchema>;
export type UpdateItemPrice = z.infer<typeof updateItemPriceSchema>;
