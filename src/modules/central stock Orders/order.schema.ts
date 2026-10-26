import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";
import { CentralOrderStatus, CentralStockOrderType } from "../../../prisma/generated/prisma/enums.js";

export const centralStockOrderReportQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  itemId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  status: z.enum(CentralOrderStatus).optional(),
  orderType: z.enum(CentralStockOrderType).optional(),
}).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { message: "startDate must be before or equal to endDate", path: ["endDate"] },
);

export const createCentralStockOrderSchema = z
  .object({
    itemId: uuidSchema,
    orderType: z.enum(["internal", "b2b"]).default("internal"),
    siteId: z.uuid().optional(),
    quantity: z.coerce.number().positive(),
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

export const createLoadingOrderSchema = z.object({
  driverVehicleId: uuidSchema,
  orders: z.array(z.object({
    orderId: uuidSchema,
    quantity: z.coerce.number().positive(),
  })).min(1),
}).refine(
  ({ orders }) => new Set(orders.map((order) => order.orderId)).size === orders.length,
  { message: "An order can only appear once per loading request", path: ["orders"] },
);

export const loadingOrderStatusSchema = z.object({
  status: z.enum(["pending", "cancelled"]),
});

export const receptionOrdersQuerySchema = paginationQuerySchema.extend({
  siteId: uuidSchema.optional(),
  receptionStatus: z.enum(["notReceived", "partiallyReceived", "received"]).optional(),
}); 

export const receiveLoadingOrderSchema = z.object({
  cuveId: uuidSchema,
  receivedQty: z.coerce.number().positive(),
  comment: z.string().optional()
}).strict();


export const CentralStockOrderParamaSchema = z.object({
  id: uuidSchema,
  status: z.enum(CentralOrderStatus),
});

/**
 * Sending a request back to be changed. The reason is required: "change it"
 * with no comment leaves the site guessing what to change it to.
 */
export const requestOrderEditSchema = z.object({
  comment: z.string().trim().min(3, "Say what needs to change").max(500),
});

/** The new quantity, from whoever raised the request. */
export const editOrderQuantitySchema = z.object({
  quantity: z.coerce.number().positive(),
  comment: z.string().trim().max(500).optional(),
});

export type CreateCentralStockOrderSchema = z.infer<
  typeof createCentralStockOrderSchema
>;
export type CentralStockOrderReportQuerySchema = z.infer<typeof centralStockOrderReportQuerySchema>;
export type CreateLoadingOrderSchema = z.infer<typeof createLoadingOrderSchema>;
export type LoadingOrderStatusSchema = z.infer<typeof loadingOrderStatusSchema>;
export type ReceptionOrdersQuerySchema = z.infer<typeof receptionOrdersQuerySchema>;
export type ReceiveLoadingOrderSchema = z.infer<typeof receiveLoadingOrderSchema>;

export type RequestOrderEditSchema = z.infer<typeof requestOrderEditSchema>;
export type EditOrderQuantitySchema = z.infer<typeof editOrderQuantitySchema>;
