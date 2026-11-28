import { z } from "zod";
import { uuidSchema } from "../../shared/validation/index.js";
import { CentralStockReceiptType, CentralStockStatus, StockStateStatus, StockTransactionType } from "../../../prisma/generated/prisma/enums.js";

export const centralStockReportQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(CentralStockStatus).optional(),
  /** How the stock came about: an import, or one of the three local kinds. */
  receiptType: z.enum(CentralStockReceiptType).optional(),
  itemId: uuidSchema.optional(),
  depotId: uuidSchema.optional(),
  // Keep this alias while the database and older clients use `deport`.
  deportId: uuidSchema.optional(),
}).refine(
  ({ depotId, deportId }) => !depotId || !deportId || depotId === deportId,
  { message: "depotId and deportId must refer to the same depot", path: ["depotId"] },
).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { message: "startDate must be before or equal to endDate", path: ["endDate"] },
);

export type CentralStockReportQuerySchema = z.infer<typeof centralStockReportQuerySchema>;

/**
 * The landing fees charged as the stock is received: what it cost to clear,
 * store and move this load. Each is charged from the fee catalogue and copies
 * its price at this moment, so a landed cost worked out today does not move
 * when the catalogue is edited tomorrow.
 *
 * Sent as a JSON array, since the form posts multipart (it carries the receipt
 * document): `fees=[{"feeTypeId":"…","count":2}]`.
 */
const feesField = z.union([z.string(), z.array(z.unknown())])
  // Optional here rather than on the array below: the key is usually absent,
  // and a union member of `z.undefined()` does not make a key optional.
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === "") return undefined;
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "fees must be a JSON array" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.object({
    feeTypeId: uuidSchema,
    /** How many times it is charged; 3 x a fixed fee, not a volume. */
    count: z.coerce.number().int().positive().max(10_000).default(1),
  })).max(50).optional());

export const createCentralStockSchema = z.object({
  /**
   * What kind of receipt this is, stated by the caller.
   *
   * **Not stored.** `t1ValidationId == null` remains the one definition of a
   * local purchase, and the refinements below tie this to it so the two can
   * never disagree. It exists purely so the *request* cannot be ambiguous:
   * with the T1 relaxed to optional, a client that simply forgot to send one
   * would otherwise have a local receipt written for it in silence, with no
   * price, no truck, and no error. Omitting it means `import`, which is what
   * every caller written before local purchases existed meant.
   */
  source: z.enum(["import", "local"]).optional(),
  deportId: uuidSchema,
  /**
   * The depot this load was **sent to**, chosen from the same list as
   * `deportId`.
   *
   * Beside where it was discharged, not instead of it: a load that went
   * somewhere other than where it was dispatched is only visible when the
   * receipt carries both ends. `Nomination.destination` is free text and may
   * name a town, so it cannot answer this.
   *
   * Optional, and emptied rather than rejected when the form sends "": every
   * receipt already on record has none.
   */
  destinationId: z
    .union([uuidSchema, z.literal("")])
    .optional()
    .nullable()
    .transform((value) => value || null),
  itemId:  uuidSchema,
  ambQuantity: z.coerce.number(),
  quantityAt20C: z.coerce.number(),
  receiptNumber: z.string(),
  /**
   * The day the truck was **actually discharged** into the depot.
   *
   * The other end of `T1Validation.loadingDate`: the pair says how long the
   * load was on the road. `createdAt` cannot say it — a receipt is keyed in
   * when the paperwork arrives, not as the hose comes off.
   *
   * Optional, and emptied rather than stored as an invalid date when the form
   * sends "": every receipt already on record has none.
   */
  offloadingDate: z
    .union([z.coerce.date(), z.literal("")])
    .optional()
    .nullable()
    .transform((value) => (value instanceof Date ? value : null)),
  supportingDocUrl: z.string().optional().nullable(),
  /**
   * The border clearance this load discharged — **imported receipts only**.
   *
   * Its absence is what makes a receipt a local purchase: fuel bought from a
   * supplier in the country crossed no border, so there is no T1 to attach.
   * Deliberately not paired with a stored `type`, which could contradict it.
   *
   * ⚠️ Nothing to do with `Deport.type`: an imported load is discharged at a
   * local depot too.
   */
  t1ValidationId: z
    .union([uuidSchema, z.literal("")])
    .optional()
    .nullable()
    .transform((value) => value || null),
  /**
   * What a litre was bought for, on a local purchase.
   *
   * The unit price alone — the total is one multiplication away and would go
   * stale the moment a quantity is corrected.
   */
  unitPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("")])
    .optional()
    .nullable()
    .transform((value) => (typeof value === "number" ? value : null)),
  /**
   * The currency of `unitPrice`, as a code. Stored as copied text, the same
   * discipline as the landing fees: retiring a currency must not rewrite what
   * a past purchase cost. Checked against the `Currency` catalogue when the
   * receipt is written, not here.
   */
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(8)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  /**
   * The truck that brought a local purchase in, as written on it —
   * `RAB123F/TR-884`. Free text, and never matched against a `Vehicle`: a
   * supplier's truck is nobody's nominated rig.
   */
  truckNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    /*
     * A transform, not `.or(z.literal(""))`: the branch above already accepts
     * an empty string, so the union was never reached and a blank field was
     * stored as `""` rather than as "none". A form always sends the field.
     */
    .transform((value) => value || null),
  /**
   * **How this stock came to be here.**
   *
   * `import` for a load that crossed a border on a T1. For a local receipt,
   * which of the three kinds it is: fuel found over (`gain`), moved in from
   * somewhere else of ours (`transfer`), or taken on loan (`borrow`).
   *
   * Required on a local receipt — it is the one question nothing else in the
   * row answers — and refused as anything but `import` on an imported one,
   * where the T1 has already answered it. Left out on an import it is stored
   * as `import` rather than null, so every receipt written from here states
   * its kind.
   */
  receiptType: z
    .enum(CentralStockReceiptType)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  /**
   * The supplier's own reference for the delivery, as written on their
   * paperwork. Free text, because it is their numbering and not ours.
   *
   * What ties a local receipt back to the supplier's documents when there is
   * no T1, no nomination and no cargo to trace it through.
   */
  sdReference: z
    .string()
    .trim()
    .max(60)
    .optional()
    .nullable()
    // Blank is "none", never a stored empty string — see `truckNumber`.
    .transform((value) => value || null),
  /**
   * Whether a local supplier's load arrives already cleared.
   *
   * A local supplier has usually paid the duty themselves, so the litres can
   * be sold the moment they land; when they have not, the stock sits uncleared
   * and goes through the ordinary clearance request later.
   *
   * `true` writes a `StockClearance` for the whole receipt in the same
   * transaction — it is a quantity sales draw against, not a flag. Ignored on
   * an imported receipt, where clearance is the border's business.
   */
  arrivesCleared: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0", ""])])
    .optional()
    .transform((value) => value === true || value === "true" || value === "1"),
  status:  z.enum(CentralStockStatus).default("inStock").optional(),
  createdBy: uuidSchema,
  // `toleranceRate`, `lossQty` and `gainQty` are **no longer taken from the
  // form**. They are what the trip lost or gained against the T1 validation,
  // worked out from the two quantities at 20 °C when the receipt is written —
  // the figure a transporter is answerable for cannot be the one typed by
  // whoever received the load. Anything sent under those names is ignored.
  /** What it cost to land this receipt. Left out when there is nothing to charge. */
  fees: feesField

})
  /*
   * The two kinds of receipt, kept from blurring into each other.
   *
   * There is no stored `type` to check against — `t1ValidationId` *is* the
   * distinction — so these refinements are the only thing standing between a
   * half-imported, half-local row and the database. A receipt that named a T1
   * *and* a unit price would leave every reader guessing which it was.
   */
  /*
   * An imported receipt must name its T1, exactly as it always had to: this is
   * the old NOT NULL, moved from the column to the request. A caller that
   * means to record a local purchase has to say so.
   */
  .refine(
    (input) => input.source === "local" || input.t1ValidationId !== null,
    {
      message: "Choose the T1 validation being received, or send source=local for a local purchase",
      path: ["t1ValidationId"],
    },
  )
  /*
   * And the reverse, so the stated kind and the data cannot drift apart: a
   * request calling itself local while carrying a T1 is a mistake, not a
   * preference to be guessed at.
   */
  .refine(
    (input) => input.source !== "local" || input.t1ValidationId === null,
    {
      message: "A local purchase has no T1 validation",
      path: ["t1ValidationId"],
    },
  )
  /*
   * An import's kind is settled by its T1: it crossed a border, and that is
   * what `import` means. Anything else on the same row would be two answers to
   * one question.
   */
  .refine(
    (input) => input.t1ValidationId === null || !input.receiptType || input.receiptType === "import",
    {
      message: "An imported receipt is an import; gain, transfer and borrow are for a local receipt",
      path: ["receiptType"],
    },
  )
  /*
   * And a local receipt has to say which of the three it is. Nothing else in
   * the row can be read for it, and guessing would put a word on the record
   * that nobody chose — so it is asked for rather than defaulted.
   */
  .refine(
    (input) => input.t1ValidationId !== null || (!!input.receiptType && input.receiptType !== "import"),
    {
      message: "Say how this stock came in: a gain, a transfer or a borrow",
      path: ["receiptType"],
    },
  )
  .refine(
    (input) => input.t1ValidationId === null || input.unitPrice === null,
    {
      message: "An imported receipt is costed by its cargo and landing fees, not a unit price",
      path: ["unitPrice"],
    },
  )
  .refine(
    (input) => input.t1ValidationId === null || !input.truckNumber,
    {
      message: "An imported load's truck comes from its nomination, so it cannot be typed here",
      path: ["truckNumber"],
    },
  )
  /*
   * An import's paperwork is the border's: its T1, its cargo's BL and the
   * references on them. A supplier's delivery reference on the same row would
   * leave two competing answers to "which document is this receipt?".
   */
  .refine(
    (input) => input.t1ValidationId === null || !input.sdReference,
    {
      message: "An imported receipt is traced through its T1 and cargo, not a supplier reference",
      path: ["sdReference"],
    },
  )
  /*
   * A price with no currency is a number nobody can add up, and a currency
   * with no price says nothing. Either both or neither.
   */
  .refine(
    (input) => (input.unitPrice === null) === (!input.currencyCode),
    {
      message: "A unit price needs its currency, and a currency needs its price",
      path: ["currencyCode"],
    },
  )
  /*
   * Clearing on arrival is a local supplier's affair. On an imported load the
   * border decides, through a clearance request and its authorizers, so
   * accepting it here would be a way round them.
   */
  .refine(
    (input) => input.t1ValidationId === null || !input.arrivesCleared,
    {
      message: "An imported load is cleared through a clearance request, not on arrival",
      path: ["arrivesCleared"],
    },
  );

export const stockTransactionSchema = z.object({
  centralStockId: uuidSchema,
  quantity: z.coerce.number().positive(),
  type: z.enum(StockTransactionType)
})

export const stockReconciliationsBodySchema = z.object({
  centralStockId: uuidSchema,
  quantity: z.coerce.number().positive(),
  reconciliationType: z.enum([StockTransactionType.reconcilliationIn, StockTransactionType.reconcilliationOut]),
  state: z.enum(StockStateStatus),
  createdBy: uuidSchema,
  note: z.string().optional(),
  supportingDocUrl: z.string().optional().nullable()
})

export type CreateCentralStockSchema = z.infer<typeof createCentralStockSchema>;
export type StockTransactionSchema = z.infer<typeof stockTransactionSchema>;
export type StockReconciliationsBodySchema = z.infer<typeof stockReconciliationsBodySchema>;
