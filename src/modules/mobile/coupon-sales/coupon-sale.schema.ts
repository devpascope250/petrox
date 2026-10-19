import { z } from "zod";
import { phoneSchema, pinSchema, uuidSchema } from "../../../shared/validation/index.js";
import { text, twoDecimals } from "../transactions/transactions.schema.js";

/** Clients with coupons they can spend, searched by name, code or phone. */
export const couponClientsQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
});

/** The client and their own PIN, which they enter at the pump. */
export const verifyClientSchema = z.object({ clientId: uuidSchema, pin: pinSchema }).strict();

/**
 * Starts a fuel sale paid with coupons. Everything about the fuel is fixed
 * here — what was sold, from where, how much — with the picture of the pump
 * display (`displayPicture`, required). The client confirms with their PIN.
 * Confirm only checks the coupons and the attendant.
 */
export const initiateCouponSaleSchema = z.object({
  clientId: uuidSchema,
  clientPin: pinSchema,
  itemId: uuidSchema,
  cuveId: uuidSchema,
  pumpId: uuidSchema,
  nozzleId: uuidSchema,
  quantity: twoDecimals("Quantity"),
  unitPrice: twoDecimals("Unit price"),
  amount: twoDecimals("Amount"),
  platNumber: text(20).transform((value) => value.toUpperCase().replace(/\s+/g, " ")).optional(),
  appVersion: text(50).optional(),
}).strict();

/** The coupons as a JSON array in a form field, or an array in a JSON body. */
const couponsField = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}, z.array(z.string().trim().min(1).max(191), { message: "coupons must be a JSON array of coupon codes" })
  .min(1, "Scan at least one coupon").max(50, "At most 50 coupons"));

/**
 * Confirms a coupon sale: the client, the coupons scanned (codes or QR tokens,
 * in the order scanned), and the attendant who served it (phone + PIN).
 */
export const confirmCouponSaleSchema = z.object({
  clientId: uuidSchema,
  coupons: couponsField,
  phone: phoneSchema.transform((value) => value.replace(/\s+/g, "")),
  pin: pinSchema,
  comments: text(500).optional().nullable(),
  appVersion: text(50).optional().nullable(),
  printStatus: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional().default(false),
}).strict();

export const cancelCouponSaleSchema = z.object({ reason: text(255) }).strict();

export const couponSaleCodeSchema = z.object({
  code: z.string().trim().regex(/^PSST\d{8}-\d{6}-\d{3}$/, "Invalid transaction code"),
});

export type InitiateCouponSaleInput = z.infer<typeof initiateCouponSaleSchema>;
export type ConfirmCouponSaleInput = z.infer<typeof confirmCouponSaleSchema>;
