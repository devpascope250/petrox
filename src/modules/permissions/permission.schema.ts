import { z } from "zod";

export const permissionSchemaBody = z.object(
    {
        name: z.string({message: "The Permission Name is required here"}).trim(),
        code: z.string( {message: "The code is required here"}).trim(),
        moduleId: z.uuid({message: "The Module Id is required Here"}),
        description: z.string().optional()
    }
);

export type PermissionSchemaBody = z.infer<typeof permissionSchemaBody>;