import { z } from "zod";
import { nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";
export const createNominationsSchema = z.object({
    stockId: uuidSchema,
    driverVehicleId: uuidSchema,
    destination: nonEmptyNameSchema,
    quantityAt20C: z.coerce.number(),
    ambQuantity: z.coerce.number().optional(),
    expectedLoadingedDate: z.coerce.date("Please provide expected date."),
    createdBy: z.string().optional()
  });

export type CreateNominationsSchema = z.infer<typeof createNominationsSchema>;