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

/**
 * Narrowing the truck list. One term, matched against the plate, the trailer,
 * the body number, the model and the transporter — and against the **pair** as
 * it is written, `RAB123F/TR-884`, which is the only name that identifies a rig
 * now that one plate may belong to two of them.
 */
export const vehicleListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});

export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;