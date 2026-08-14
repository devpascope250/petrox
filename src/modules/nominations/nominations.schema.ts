import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";
export const createNominationsSchema = z.object({
    stockId: uuidSchema,
    driverVehicleId: uuidSchema,
    destination: nonEmptyNameSchema,
    quantity: z.coerce.number(),
    expectedLoadingedDate: z.coerce.date("Please provide expected date."),
  });

export type CreateNominationsSchema = z.infer<typeof createNominationsSchema>;