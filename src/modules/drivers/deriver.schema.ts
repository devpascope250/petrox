import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";

export const createDriverSchema = z.object({
    names: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    lisence: nonEmptyNameSchema,
    paassport: nonEmptyNameSchema,
    transporterId: uuidSchema,
  });

export type CreateDriverSchema = z.infer<typeof createDriverSchema>;