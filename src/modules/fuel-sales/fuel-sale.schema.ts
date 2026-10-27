import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/** A working day, "YYYY-MM-DD" — the same day the time table uses. */
const daySchema = z.iso.date("Must be a date like 2026-10-05");

/** A site shift, or "none" for sales recorded without one. */
const shiftFilterSchema = z.union([uuidSchema, z.literal("none")]);

const periodOrder = {
  check: ({ startDate, endDate }: { startDate?: string; endDate?: string }) =>
    !startDate || !endDate || startDate <= endDate,
  issue: { message: "startDate must be before or equal to endDate", path: ["endDate"] },
};

export const fuelSaleOptionsQuerySchema = z.object({
  siteId: uuidSchema.optional(),
});

/**
 * A sale: litres through one pump, the money it brought in, and the accounts
 * that money went to. The nozzle is optional; when it is given it decides the
 * cuve, otherwise the cuve the fuel came out of is named directly.
 */
export const createFuelSaleSchema = z.object({
  pumpId: uuidSchema,
  nozzleId: uuidSchema.nullable().optional(),
  /** The tank drawn from. Required when no nozzle is given. */
  cuveId: uuidSchema.nullable().optional(),
  /** The site shift it was sold on (`TblShiftSite`). */
  shiftId: uuidSchema.nullable().optional(),
  /** The working day it counts towards. Worked out from the shift when left out. */
  dateOn: daySchema.optional(),
  quantity: z.coerce.number("Quantity must be a number").positive("Quantity must be more than zero"),
  /**
   * Price per unit at the pump. It must be the price in force for the tank's
   * product: the sale is charged at that price, so a stale one is refused
   * rather than quietly overridden.
   */
  unitPrice: z.coerce.number("Price must be a number").positive("Price must be more than zero"),
  /**
   * What the pump showed — quantity x price, give or take rounding — **before
   * any discount**. A discount in force is worked out by the server and taken
   * off; the `payments` must add up to what is left, which `GET
   * /fuel-sales/quote` gives as `amount`.
   */
  amount: z.coerce.number("Amount must be a number").positive("Amount must be more than zero"),
  note: z.string().trim().max(190).optional(),
  payments: z.array(z.object({
    accountId: z.string().trim().min(1, "Choose an account"),
    amount: z.coerce.number("Amount must be a number").positive("Amount must be more than zero"),
    reference: z.string().trim().max(100).optional(),
    /** Set by the server from an uploaded document — see fuel-sale-upload.ts. */
    referenceDocUrl: z.string().startsWith("/uploads/").optional(),
  })).min(1, "Add at least one payment"),
}).refine((sale) => Boolean(sale.nozzleId || sale.cuveId), {
  message: "Choose the tank the fuel came from", path: ["cuveId"],
});

/** What a sale of this volume from this tank would come to, discount included. */
export const fuelSaleQuoteQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  cuveId: uuidSchema,
  quantity: z.coerce.number("Quantity must be a number").positive("Quantity must be more than zero"),
});

export const fuelSaleListQuerySchema = paginationQuerySchema.extend({
  siteId: uuidSchema.optional(),
  startDate: daySchema.optional(),
  endDate: daySchema.optional(),
  shiftId: shiftFilterSchema.optional(),
  nozzleId: uuidSchema.optional(),
}).refine(periodOrder.check, periodOrder.issue);

/** With no dates, the report covers the latest working day. */
export const fuelSaleReportQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  startDate: daySchema.optional(),
  endDate: daySchema.optional(),
  shiftId: shiftFilterSchema.optional(),
}).refine(periodOrder.check, periodOrder.issue);

export type CreateFuelSale = z.infer<typeof createFuelSaleSchema>;
export type FuelSaleQuoteQuery = z.infer<typeof fuelSaleQuoteQuerySchema>;
export type FuelSaleListQuery = z.infer<typeof fuelSaleListQuerySchema>;
export type FuelSaleReportQuery = z.infer<typeof fuelSaleReportQuerySchema>;
export type FuelSaleFilters = Pick<FuelSaleListQuery, "startDate" | "endDate" | "shiftId" | "nozzleId">;
