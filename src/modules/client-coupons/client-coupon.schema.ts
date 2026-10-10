import { z } from "zod";
import { ClientCouponStatus } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";
import { couponAmountSchema } from "../coupon-plans/coupon-plan.schema.js";

/**
 * A code entered by hand is kept readable like a generated one: trimmed,
 * upper-cased, and only letters, digits and single hyphens between groups.
 */
const couponCodeSchema = z.string().trim().toUpperCase()
  .min(4, "Code must be at least 4 characters").max(64)
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Code may contain only letters, digits and hyphens between groups, e.g. CPN-7KQ4-M9XT-2HRW");
const dateSchema = z.iso.datetime({ offset: true }).transform(value => new Date(value));
export const createClientCouponSchema = z.object({
  couponPlanId: uuidSchema,
  clientId: uuidSchema,
  code: couponCodeSchema.optional(),
  token: z.string().trim().min(1).max(191).optional(),
  export: z.boolean().optional(),
  amount: couponAmountSchema.optional(),
  generatedAt: dateSchema.optional(),
  printedAt: dateSchema.nullable().optional(),
  scannedAt: dateSchema.nullable().optional(),
  status: z.enum(ClientCouponStatus).optional(),
}).strict();
export const updateClientCouponSchema = createClientCouponSchema.partial()
  .refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const clientCouponStatusSchema = z.object({ status: z.enum(ClientCouponStatus) }).strict();
export const clientCouponQuerySchema = paginationQuerySchema.extend({
  couponPlanId: uuidSchema.optional(),
  clientId: uuidSchema.optional(),
  status: z.enum(ClientCouponStatus).optional(),
  // Searched as typed, so a lower-case entry still finds the coupon.
  code: z.string().trim().toUpperCase().min(1).max(191).optional(),
  export: z.enum(["true", "false"]).transform(value => value === "true").optional(),
});
/** Clients holding coupons, optionally narrowed by name, email or code. */
export const clientCouponClientQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type ClientCouponClientQuery = z.infer<typeof clientCouponClientQuerySchema>;
export type CreateClientCouponInput = z.infer<typeof createClientCouponSchema>;
export type UpdateClientCouponInput = z.infer<typeof updateClientCouponSchema>;
export type ClientCouponQuery = z.infer<typeof clientCouponQuerySchema>;
