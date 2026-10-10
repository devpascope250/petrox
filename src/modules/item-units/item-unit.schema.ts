import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/** How many of the item's base unit one of this unit equals; 1 for the base unit itself. */
const factorSchema = z.coerce.number("Must be a whole number").int("Must be a whole number").positive("Must be at least 1");

export const createItemUnitSchema = z.object({
  itemId: uuidSchema,
  unitId: uuidSchema,
  factorialValue: factorSchema,
});

export const updateItemUnitSchema = z.object({
  itemId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  factorialValue: factorSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export type CreateItemUnit = z.infer<typeof createItemUnitSchema>;
export type UpdateItemUnit = z.infer<typeof updateItemUnitSchema>;
