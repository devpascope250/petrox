import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";

export const createSiteSchema = z.object({
    name: nonEmptyNameSchema,
    phone: z.string().optional(),
    email: z.email().optional(),
    address: z.string().optional(),
    status: z.enum(["active", "inactive"]).default("active"),
  });

export type CreateSiteSchema = z.infer<typeof createSiteSchema>;