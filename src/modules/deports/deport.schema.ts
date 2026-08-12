import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";
import { DeportType, StatusType } from "../../../prisma/generated/prisma/enums.js";

export const createDeportSchema = z.object({
    name: nonEmptyNameSchema,
    type: z.enum(DeportType).default("local"),
    location: nonEmptyNameSchema,
  });

export type CreateDeportSchema = z.infer<typeof createDeportSchema>;