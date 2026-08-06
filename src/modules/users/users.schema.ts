import { z } from "zod";
import { emailSchema, nonEmptyNameSchema, passwordSchema, phoneSchema, pinSchema, uuidSchema } from "../../shared/validation/index.js";

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  pin: pinSchema.optional(),
  firstName: nonEmptyNameSchema,
  lastName: nonEmptyNameSchema,
  phone: phoneSchema.optional(),
  roleId: uuidSchema
});