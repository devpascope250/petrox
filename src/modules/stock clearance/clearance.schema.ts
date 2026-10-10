import { z } from "zod";
import { uuidSchema} from "../../shared/validation/index.js";

export const createStockClearanceSchema = z.object({
    type: z.enum(["fifo", "manual"]),
    centralStockId: uuidSchema.optional(),
    itemId: uuidSchema,
    quantity: z.coerce.number().positive(),
    fees: z.coerce.number().nonnegative().optional(),
    amount: z.coerce.number().nonnegative().optional(),
    clearedBy: uuidSchema.optional(),
    agentId: uuidSchema.optional(),
    dmsDocUrl: z.string().optional(),
    assessmentDocUrl: z.string().optional(),
  }).refine((data) => { 
    // id type == "manual" requires centralStockId to be present
    if (data.type === "manual" && !data.centralStockId) {
      return false;
    }
    return true;
  }, {
    message: "centralStockId is required for manual clearance",
  });

export type CreateStockClearanceSchema = z.infer<typeof createStockClearanceSchema>;
