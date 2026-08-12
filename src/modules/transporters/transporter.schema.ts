import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";

export const createTransporterSchema = z.object({
    name: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    address: nonEmptyNameSchema,
    tinNumber: nonEmptyNameSchema,
    // status: z.enum(StatusType).default("active")
  });

export type CreateTransporterSchema = z.infer<typeof createTransporterSchema>;