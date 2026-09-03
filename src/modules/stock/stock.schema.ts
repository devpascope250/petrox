import { z } from "zod";
import { cuidParamsSchema, nonEmptyNameSchema, uuidSchema} from "../../shared/validation/index.js";
import { StockStatus } from "../../../prisma/generated/prisma/enums.js";

export const stockReportQuerySchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    status: z.enum(StockStatus).optional(),
    depotId: uuidSchema.optional(),
    // Keep this alias while the database and older clients use `deport`.
    deportId: uuidSchema.optional(),
}).refine(
    ({ depotId, deportId }) => !depotId || !deportId || depotId === deportId,
    { message: "depotId and deportId must refer to the same depot", path: ["depotId"] },
);

export type StockReportQuerySchema = z.infer<typeof stockReportQuerySchema>;

export const createStockSchema = z.object({
    deportId: uuidSchema,
    cargoId: z.cuid2(),
    quantity: z.coerce.number(),
    receivedDate: z.coerce.date("Please provide Received date."),
    status: z.enum(StockStatus).optional().default("awaiting"),
  });

export type CreateStockSchema = z.infer<typeof createStockSchema>;
