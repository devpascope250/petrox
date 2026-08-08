import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";

export const createRoleSchema = z.object({
  name: nonEmptyNameSchema.min(2),
  permissionIds: z.array(uuidSchema).max(250).default([])
});

export const deleteParamSchema = z.object({
  id: z.uuid({message: "The Role id must be uuid format"})
});

export const assignPermissionsToRole = z.object({
  name: z.string({message: "The name is required here"}),
  permissionIds: z.array(uuidSchema).max(250).default([])
});
