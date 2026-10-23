import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import { pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * Sends a vehicle to a parking. The vehicle is not named: it is the one on the
 * nomination, so a client cannot park a truck that is not on the trip.
 */
export const assignVehicleLocationSchema = z.object({
  nominationId: uuidSchema,
  parkingId: uuidSchema,
  /** Set when the vehicle is already standing there; left out while it is on its way. */
  arrivedAt: z.coerce.date().optional(),
});

/** Marks a vehicle as having reached the parking it was sent to. */
export const markArrivedSchema = z.object({
  arrivedAt: z.coerce.date().optional(),
});

/** A page of where vehicles have stood, narrowed by when they were sent. */
export const vehicleLocationListQuerySchema = pagedDatesQuerySchema.extend({
  parkingId: uuidSchema.optional(),
  nominationId: uuidSchema.optional(),
  status: z.enum(StatusType).optional(),
  /** Only those that have not reached the parking yet. */
  pending: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
  /** Matches the plate, the truck number or the driver's name. */
  search: z.string().trim().max(100).optional(),
});

export type AssignVehicleLocationSchema = z.infer<typeof assignVehicleLocationSchema>;
export type MarkArrivedSchema = z.infer<typeof markArrivedSchema>;
export type VehicleLocationListQuery = z.infer<typeof vehicleLocationListQuerySchema>;
