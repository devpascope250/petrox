import { z } from "zod";
import { cuidParamsSchema, nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";
import { StockStatus } from "../../../prisma/generated/prisma/enums.js";

export const createStockSchema = z.object({
    deportId: uuidSchema,
    cargoId: z.cuid2(),
    quantity: z.coerce.number(),
    receivedDate: z.coerce.date("Please provide Received date."),
    status: z.enum(StockStatus).optional().default("awaiting"),
  });

export type CreateStockSchema = z.infer<typeof createStockSchema>;