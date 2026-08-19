import { z } from "zod";
import { uuidSchema } from "../../shared/validation/primitives.js";

export const createCentralStockOrderSchema = z
  .object({
    itemId: uuidSchema,
    orderType: z.enum(["internal", "b2b"]).default("internal"),

    siteId: z.uuid().optional(),

    clearanceId: uuidSchema.optional(),

    quantity: z.coerce.number().nonnegative(),

    unitPrice: z.coerce.number().nonnegative(),

    totalPrice: z.coerce.number().nonnegative().optional(),

    createdBy: z.uuid(),

    approvedBy: z.uuid().optional(),

    status: z
      .enum(["pending", "approved", "rejected", "cancelled"])
      .default("pending"),
  })
  .refine(
    (data) => {
      if (data.orderType === "internal") {
        return data.siteId !== undefined;
      }

      return true;
    },
    {
      message: "siteId is required when orderType is internal",
      path: ["siteId"],
    }
  );

export type CreateCentralStockOrderSchema = z.infer<
  typeof createCentralStockOrderSchema
>;