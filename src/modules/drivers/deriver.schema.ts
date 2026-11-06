import { z } from "zod";
import { nonEmptyNameSchema, paginationQuerySchema, uuidSchema} from "../../shared/validation/index.js";

export const createDriverSchema = z.object({
    names: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    lisence: nonEmptyNameSchema,
    paassport: nonEmptyNameSchema,
    transporterId: uuidSchema,
  });

export type CreateDriverSchema = z.infer<typeof createDriverSchema>;

/**
 * One page of drivers, searched on the server.
 *
 * Searching has to travel with the page: a fleet runs to hundreds of drivers,
 * so the page the browser holds is a slice, and filtering that slice would
 * answer "no driver by that name" for a driver sitting on another page.
 */
export const driverListQuerySchema = paginationQuerySchema.extend({
  /** Matched against the name, phone, licence, passport and transporter. */
  search: z.string().trim().max(80).optional(),
  /** Active, inactive, or — left out — both. Also a page's filter, for the same reason. */
  status: z.enum(["active", "inactive"]).optional(),
});

export type DriverListQuery = z.infer<typeof driverListQuerySchema>;