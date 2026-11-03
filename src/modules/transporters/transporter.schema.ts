import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";

export const createTransporterSchema = z.object({
    name: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    /**
     * Where a tolerance statement is sent. Optional — a transporter carries
     * loads whether or not anyone has their address — and blank is stored as
     * nothing rather than an empty string, so "has an address" is one check.
     */
    email: z.email("Enter a valid email address").optional().nullable()
      .or(z.literal("").transform(() => null))
      .transform((value) => value || null),
    address: nonEmptyNameSchema,
    tinNumber: nonEmptyNameSchema,
    // status: z.enum(StatusType).default("active")
  });

export type CreateTransporterSchema = z.infer<typeof createTransporterSchema>;