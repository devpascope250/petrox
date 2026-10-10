import { z } from "zod";
import { uuidSchema } from "../../shared/validation/primitives.js";

export const moduleItemsSchemaBody = z
  .object({
    name: z.string({ message: "Please the name of module is required here" }),
    code: z.string().min(2).optional(),
    icon: z.string().optional().nullable(),
    parentId: z.uuid().optional().nullable(),
  })
  .transform((data) => ({
    ...data,
    code:
      data.code ??
      data.name
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_")
        .replace(/[^A-Z0-9_]/g, ""),
  }));

  export const updateMouleSchemaBody = z
  .object({
    id:   uuidSchema,
    name: z.string({ message: "Please the name of module is required here" }),
    icon: z.string().optional().nullable(),
  });

/** The same fields without the id, for `PUT /edit/:id` where the id is in the path. */
export const updateModuleFieldsSchema = updateMouleSchemaBody.omit({ id: true });

export const moduleSortingBodySchema = z.object({
  categoryId: uuidSchema,
  sortingNumber: z.coerce.number().positive(),
});
export const moduleSortingSchema = z.array(moduleSortingBodySchema);

export const moduleSchemaBody = z.array(moduleItemsSchemaBody);
export type ModuleItemsSchemaBody = z.infer<typeof moduleItemsSchemaBody>;
export type ModuleSortingSchema = z.infer<typeof moduleSortingSchema>;
export type ModuleSortingBodySchema = z.infer<typeof moduleSortingBodySchema>;
export type ModuleSchemaBody = z.infer<typeof moduleSchemaBody>;
export type UpdateModuleSchemaBody = z.infer<typeof updateMouleSchemaBody>;
