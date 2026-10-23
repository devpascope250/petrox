import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import {
  nonEmptyNameSchema,
  pagedDatesQuerySchema,
} from "../../shared/validation/index.js";

/** A page of the parkings, narrowed by when they were added and by status. */
export const parkingListQuerySchema = pagedDatesQuerySchema.extend({
  status: z.enum(StatusType).optional(),
  /** Matches the name or the location. */
  search: z.string().trim().max(100).optional(),
});

export const createParkingSchema = z.object({
  name: nonEmptyNameSchema,
  location: nonEmptyNameSchema,
  status: z.enum(StatusType).optional(),
});

export type ParkingListQuery = z.infer<typeof parkingListQuerySchema>;
export type CreateParkingSchema = z.infer<typeof createParkingSchema>;
