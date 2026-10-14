import { z } from "zod";
import { phoneSchema, pinSchema, uuidSchema } from "../../../shared/validation/index.js";

/** At most two decimals: what the columns hold, so nothing is rounded away silently. */
const twoDecimals = (label: string) => z.coerce.number({ message: `${label} must be a number` })
  .positive(`${label} must be more than 0`)
  .max(1_000_000_000, `${label} is too large`)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `${label} can have at most 2 decimals`);

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Starts a sale at the pump: what is being sold, from where, and — for a card
 * sale — whose card and which vehicle. The plate picture arrives as the
 * `platePicture` file. There is no `siteId`: the site is always the device's,
 * from its credential, and a `siteId` field is refused.
 */
export const initiateTransactionSchema = z.object({
  itemId: uuidSchema,
  cuveId: uuidSchema,
  pumpId: uuidSchema,
  nozzleId: uuidSchema,
  /** The `CardCopy` id from `GET /mobile/cards/:serialNumber` (`cardCopyId`). */
  cardCopyId: z.coerce.bigint({ message: "Invalid card" }).positive("Invalid card").optional(),
  platNumber: text(20).transform((value) => value.toUpperCase().replace(/\s+/g, " ")).optional(),
  appVersion: text(50).optional(),
}).strict();

const paymentSchema = z.object({
  accountId: z.string().trim().min(1).max(64),
  amount: twoDecimals("Payment amount"),
  reference: text(100).optional(),
}).strict();

/**
 * `payments` arrives as a JSON array in one form field; each payment's
 * document as the file `referenceDoc.<n>`, `n` its position in that array.
 */
const paymentsField = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: "custom", message: "payments must be a JSON array" });
    return z.NEVER;
  }
}).pipe(z.array(paymentSchema).max(10, "At most 10 payments"));

/**
 * Closes a sale: the attendant who served it signs with phone and PIN — they
 * must be on the rota for the sale's pump and nozzle in the shift running
 * now — and the litres delivered, the price, the amount and how it was paid
 * are recorded, as the pump display shows them. The picture of the pump
 * display arrives as the `displayPicture` file.
 */
export const confirmTransactionSchema = z.object({
  phone: phoneSchema.transform((value) => value.replace(/\s+/g, "")),
  pin: pinSchema,
  quantity: twoDecimals("Quantity"),
  unitPrice: twoDecimals("Unit price"),
  amount: twoDecimals("Amount"),
  payments: paymentsField.optional(),
  shiftId: uuidSchema.optional(),
  comments: text(500).optional(),
  appVersion: text(50).optional(),
  printStatus: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
}).strict();

export const cancelTransactionSchema = z.object({
  reason: text(255),
}).strict();

/** Which sales to list; `initiated` (still open) when not given. */
export const listTransactionsQuerySchema = z.object({
  status: z.enum(["initiated", "confirmed", "cancelled"]).default("initiated"),
}).strict();

export const transactionCodeParamsSchema = z.object({
  code: z.string().trim().regex(/^PSST\d{8}-\d{6}-\d{3}$/, "Invalid transaction code"),
});

export type InitiateTransactionInput = z.infer<typeof initiateTransactionSchema>;
export type ConfirmTransactionInput = z.infer<typeof confirmTransactionSchema>;
export type CancelTransactionInput = z.infer<typeof cancelTransactionSchema>;
