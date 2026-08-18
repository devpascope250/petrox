import { z } from "zod";
import { uuidSchema} from "../../shared/validation/index.js";

export const createStockClearanceSchema = z.object({
    centralStockId: uuidSchema,
    quantity: z.coerce.number().nonnegative(),
    fees: z.coerce.number().nonnegative(),
    amount: z.coerce.number().nonnegative(),
    status: z.enum(["uncleared", "cleared"]).default("uncleared"),
    clearedBy: uuidSchema.optional(),
    agentId: uuidSchema.optional(),
    supportingDocUrl: z.string().optional(),
    dmsDocUrl: z.string().optional(),
  });

export type CreateStockClearanceSchema = z.infer<typeof createStockClearanceSchema>;