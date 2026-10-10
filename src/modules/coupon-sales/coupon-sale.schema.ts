import { z } from "zod";
import { paginationQuerySchema } from "../../shared/validation/index.js";
import { couponLinesSchema } from "../client-wallets/client-wallet.schema.js";

/**
 * Clients are found by name, email or code. The search is required: there can
 * be many clients, so they are never listed wholesale.
 */
export const couponSaleClientQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(2, "Type at least 2 characters to search").max(100)
});

/** A sale: the wallet that pays, and how many coupons of each plan. */
export const couponSaleSchema = z.object({
  walletId: z.string().trim().min(1).max(191),
  items: couponLinesSchema
}).strict();

export type CouponSaleClientQuery = z.infer<typeof couponSaleClientQuerySchema>;
export type CouponSaleInput = z.infer<typeof couponSaleSchema>;
