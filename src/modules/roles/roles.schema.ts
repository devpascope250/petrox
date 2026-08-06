import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";

export const createRoleSchema = z.object({
  name: nonEmptyNameSchema.min(2),
  permissionIds: z.array(uuidSchema).max(250).default([])
});
