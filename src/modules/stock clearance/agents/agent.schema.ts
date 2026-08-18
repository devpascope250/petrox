import { z } from "zod";
import { nonEmptyNameSchema } from "../../../shared/validation/primitives.js";

export const createClearingAgentSchema = z.object({
    names: nonEmptyNameSchema,
    fees: z.coerce.number().nonnegative(),
  });

export type CreateClearingAgentSchema = z.infer<typeof createClearingAgentSchema>;