import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createDisplaySchema = z.object({
    name: nonEmptyNameSchema,
    code: nonEmptyNameSchema,
    pumpId: uuidSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreateDisplaySchema = z.infer<typeof createDisplaySchema>;