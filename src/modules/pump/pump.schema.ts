import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createPumpSchema = z.object({
    name: nonEmptyNameSchema,
    siteId: uuidSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreatePumpSchema = z.infer<typeof createPumpSchema>;