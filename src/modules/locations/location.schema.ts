import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";
import { id } from "zod/locales";

export const createLocationSchema = z.object({
  id:  uuidSchema.optional(),
  name: nonEmptyNameSchema,
  parentId: uuidSchema.optional().nullable(),
});

export const createBuikLocationSchema = 
z.array(
z.object({
  id:  uuidSchema.optional(),
  name: nonEmptyNameSchema,
  parentId: uuidSchema.optional().nullable(),
})
);

export const parentLocationParamsSchema = z.object({
  parentId: uuidSchema,
});

export type CreateLocationSchema = z.infer<typeof createLocationSchema>;
export type CreateBuikLocationSchema = z.infer<typeof createBuikLocationSchema>;
