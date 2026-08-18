import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createCuveSchema = z.object({
    name: nonEmptyNameSchema,
    itemId: uuidSchema,
    minimum: z.coerce.number("Minimum must be a number"),
    maximum: z.coerce.number("Maximum must be a number"),
    deadStock: z.coerce.number("Dead stock must be a number"),
    siteId: uuidSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreateCuveSchema = z.infer<typeof createCuveSchema>;