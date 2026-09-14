import { z } from "zod";
import { ClientCouponStatus } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";
import { couponAmountSchema } from "../coupon-plans/coupon-plan.schema.js";

const dateSchema = z.iso.datetime({ offset: true }).transform(value => new Date(value));
export const createClientCouponSchema = z.object({
  couponPlanId: uuidSchema,
  clientId: uuidSchema,
  code: z.string().trim().min(1).max(191).optional(),
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
  code: z.string().trim().min(1).max(191).optional(),
  export: z.enum(["true", "false"]).transform(value => value === "true").optional(),
});
export type CreateClientCouponInput = z.infer<typeof createClientCouponSchema>;
export type UpdateClientCouponInput = z.infer<typeof updateClientCouponSchema>;
export type ClientCouponQuery = z.infer<typeof clientCouponQuerySchema>;
