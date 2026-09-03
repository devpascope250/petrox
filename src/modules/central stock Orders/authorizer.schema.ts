import { z } from "zod";
import { uuidSchema } from "../../shared/validation/primitives.js";

export const authorizerSchema = z.object({
  type: z.enum(["LOADING_ORDER"]).default("LOADING_ORDER"),
  levels: z.coerce.number().int().positive().default(1),
  roleId: uuidSchema,
});

export type AuthorizerSchema = z.infer<typeof authorizerSchema>;
