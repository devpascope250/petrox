import { z } from "zod";
import { StatusType } from "../../../prisma/generated/prisma/enums.js";
import { paginationQuerySchema } from "../../shared/validation/index.js";

export const couponAmountSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, "Amount must have at most 16 integer digits and 2 decimal places"))
  .refine(value => Number(value) > 0, "Amount must be greater than zero");

export const createCouponPlanSchema = z.object({
  name: z.string().trim().min(1).max(191),
  number: z.number().int().positive().max(2147483647),
  amount: couponAmountSchema,
  status: z.enum(StatusType).optional(),
}).strict();
export const updateCouponPlanSchema = createCouponPlanSchema.partial()
  .refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const couponPlanStatusSchema = z.object({ status: z.enum(StatusType) }).strict();
export const couponPlanQuerySchema = paginationQuerySchema.extend({
  status: z.enum(StatusType).optional(),
  search: z.string().trim().min(1).max(191).optional(),
});
export type CreateCouponPlanInput = z.infer<typeof createCouponPlanSchema>;
export type UpdateCouponPlanInput = z.infer<typeof updateCouponPlanSchema>;
export type CouponPlanQuery = z.infer<typeof couponPlanQuerySchema>;
