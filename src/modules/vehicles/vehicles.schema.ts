import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createVehicleSchema = z.object({
    platNumber: nonEmptyNameSchema,
    transporterId: uuidSchema,
    truckNumber: nonEmptyNameSchema,
    trailerNumber: nonEmptyNameSchema,
    model: nonEmptyNameSchema,
    tankCapacity: z.coerce.number()
    // status: z.enum(StatusType).default("active")
  });

export type CreateVehicleSchema = z.infer<typeof createVehicleSchema>;