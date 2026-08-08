import { z } from 'zod';


  export const moduleItemsSchemaBody = z
  .object({
    name: z.string({ message: "Please the name of module is required here" }),
    code: z.string().min(2).optional(),
      icon: z.string().optional().nullable(),
    parentId: z.uuid().optional().nullable(),
  })
  .transform((data) => ({
    ...data,
    code: data.code ?? data.name
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_")
      .replace(/[^A-Z0-9_]/g, ""),
  }));

  export const moduleSchemaBody = z.array(moduleItemsSchemaBody);
  export type ModuleItemsSchemaBody = z.infer<typeof moduleItemsSchemaBody>;
  export type ModuleSchemaBody = z.infer<typeof moduleSchemaBody>;