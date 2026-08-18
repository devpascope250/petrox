import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createNozzleSchema = z.object({
    name: nonEmptyNameSchema,
    pumpId: uuidSchema,
    displayId: uuidSchema,
    cuveId: uuidSchema,
    nozzleCode: nonEmptyNameSchema,
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreateNozzleSchema = z.infer<typeof createNozzleSchema>;