import { z } from "zod";
import { emailSchema, nonEmptyNameSchema, passwordSchema, phoneSchema, pinSchema, uuidSchema } from "../../shared/validation/index.js";

export const createItemSchema = z.object({
    name: nonEmptyNameSchema,
    descriptions: z.string().optional().nullable(),
    parentId: z.uuid().optional().nullable(),
    baseUnitId: z.uuid().optional().nullable(),
    units: z.array(
      z.object({
        unitId: uuidSchema,
        factorialValue: z.int().positive()
      })
    ).max(250).optional()
  });

export const createUnitSchema = z.object({
    name: nonEmptyNameSchema,
    code: nonEmptyNameSchema
});

export type CreateUnitSchema = z.infer<typeof createUnitSchema>;


export type CreateItemSchema = z.infer<typeof createItemSchema>;