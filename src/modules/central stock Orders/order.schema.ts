import { z } from "zod";
import { pagedDatesQuerySchema, paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";
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

/**
 * A load to build, from either side of the house.
 *
 * `requisitionLines` is the station's way: accepted requisition lines, whose
 * cleared stock is **drawn as the load is built** — that is where an internal
 * transfer commits its litres. `orders` is the older way, naming draws that
 * already exist, which is what a B2B sale still does.
 *
 * One or the other must be given, and a load may carry both: the same truck can
 * take a station's fuel and a customer's on one trip.
 */
export const createLoadingOrderSchema = z.object({
  driverVehicleId: uuidSchema,
  orders: z.array(z.object({
    orderId: uuidSchema,
    quantity: z.coerce.number().positive(),
  })).default([]),
  requisitionLines: z.array(z.object({
    requisitionLineId: uuidSchema,
    quantity: z.coerce.number().positive(),
  })).default([]),
}).refine(
  ({ orders }) => new Set(orders.map((order) => order.orderId)).size === orders.length,
  { message: "An order can only appear once per loading request", path: ["orders"] },
).refine(
  ({ requisitionLines }) =>
    new Set(requisitionLines.map((line) => line.requisitionLineId)).size === requisitionLines.length,
  { message: "A requisition line can only appear once per loading request", path: ["requisitionLines"] },
).refine(
  ({ orders, requisitionLines }) => orders.length + requisitionLines.length > 0,
  { message: "Name the requisition lines or the orders this load carries", path: ["requisitionLines"] },
);

export const loadingOrderStatusSchema = z.object({
  status: z.enum(["pending", "cancelled"]),
});

/**
 * Where a load is in its life, as one value the list can be narrowed to.
 *
 * Authorisation comes first: nothing can be received until every authoriser has
 * signed, so an unsigned load is "awaiting approval" whatever else is true.
 * The same order the client's own `loadStage` reads, so a tab and its rows
 * cannot disagree.
 */
export const loadingOrderStageSchema = z.enum([
  "awaitingApproval", "toReceive", "partiallyReceived", "received", "cancelled",
]);

/**
 * One page of loading orders, in a date window.
 *
 * A date filter on its own is not enough — a wide window still returns every
 * load inside it — so the page, the search and the stage are asked for in the
 * same query. Searching has to travel with the paging: sifting one page of rows
 * in the browser would answer "no matches" for a load sitting on another.
 */
export const loadingOrderListQuerySchema = pagedDatesQuerySchema.extend({
  /** Matched against the product, destination, vehicle, driver and requester. */
  search: z.string().trim().max(80).optional(),
  stage: loadingOrderStageSchema.optional(),
}).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { message: "startDate must be before or equal to endDate", path: ["endDate"] },
);

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
export type LoadingOrderStage = z.infer<typeof loadingOrderStageSchema>;
export type LoadingOrderListQuery = z.infer<typeof loadingOrderListQuerySchema>;
export type ReceptionOrdersQuerySchema = z.infer<typeof receptionOrdersQuerySchema>;
export type ReceiveLoadingOrderSchema = z.infer<typeof receiveLoadingOrderSchema>;

export type RequestOrderEditSchema = z.infer<typeof requestOrderEditSchema>;
export type EditOrderQuantitySchema = z.infer<typeof editOrderQuantitySchema>;
