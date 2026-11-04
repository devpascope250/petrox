import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";

/**
 * A tax charged on a clearance: which catalogue code, and what it came to.
 *
 * The amount is per clearance, never per code — the same tax is a different
 * figure on every load.
 */
export const clearanceTaxLineSchema = z.object({
  taxId: uuidSchema,
  amount: z.coerce.number().nonnegative(),
});

/**
 * Sent as a multipart field, so it arrives as a JSON string from the browser
 * and as an array from a test or another service. Both are accepted.
 */
const taxLinesSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return [];
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}, z.array(clearanceTaxLineSchema));

export const createStockClearanceSchema = z.object({
    type: z.enum(["fifo", "manual"]),
    centralStockId: uuidSchema.optional(),
    itemId: uuidSchema,
    quantity: z.coerce.number().positive(),
    fees: z.coerce.number().nonnegative().optional(),
    /*
     * There is no manual `amount` any more: the total is the taxes added up,
     * written from the lines below. A figure typed over the taxes it is meant
     * to be the sum of is a figure nobody can check.
     */
    taxes: taxLinesSchema.optional().default([]),
    clearedBy: uuidSchema.optional(),
    agentId: uuidSchema.optional(),
    dmsDocUrl: z.string().optional(),
    assessmentDocUrl: z.string().optional(),
    supportingDocUrl: z.string().optional(),
  }).refine((data) => {
    // id type == "manual" requires centralStockId to be present
    if (data.type === "manual" && !data.centralStockId) {
      return false;
    }
    return true;
  }, {
    message: "centralStockId is required for manual clearance",
  }).refine((data) => {
    const ids = data.taxes.map((tax) => tax.taxId);
    return new Set(ids).size === ids.length;
  }, {
    message: "The same tax cannot be charged twice on one clearance",
    path: ["taxes"],
  });

export type CreateStockClearanceSchema = z.infer<typeof createStockClearanceSchema>;

/** Confirming payment: the document is the proof, so it is required. */
export const confirmClearancePaymentSchema = z.object({
  paymentDocUrl: z.string().min(1, "A payment document is required"),
});

export type ConfirmClearancePaymentSchema = z.infer<typeof confirmClearancePaymentSchema>;
