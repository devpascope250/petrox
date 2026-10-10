import { z } from "zod";
import { paginationQuerySchema, pinSchema, uuidSchema } from "../../../shared/validation/index.js";

const bigintIdSchema = z.coerce.bigint().positive("Id must be a positive integer");
const nullableText = z.string().trim().min(1).max(100).nullable().optional();
const balanceSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, "Invalid monetary amount"));

export const cardParamsSchema = z.object({ id: z.string().trim().min(1).max(100) });

/**
 * A PIN to check, for the card scanned (`serialNumber`) or for a card
 * assignment the POS already knows (`cardCopyId`) — one of the two.
 */
export const verifyCardPinSchema = z.object({
  serialNumber: z.string().trim().min(1).max(100).optional(),
  cardCopyId: z.coerce.bigint().positive("Invalid card").optional(),
  pin: pinSchema,
}).strict().refine((body) => Boolean(body.serialNumber) !== Boolean(body.cardCopyId), {
  message: "Send either serialNumber or cardCopyId", path: ["serialNumber"],
});

export type VerifyCardPinInput = z.infer<typeof verifyCardPinSchema>;

/**
 * Listing is paged, so searching has to happen here rather than over one page
 * of rows: a card is found by its number, the serial bound to it, or its code.
 */
export const cardListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  /** `true` narrows to cards free to assign, `false` to those already held. */
  available: z.enum(["true", "false"]).optional()
    .transform((value) => (value === undefined ? undefined : value === "true"))
});

/** Assignments are searched by client and by either card on them. */
export const cardCopyListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * Narrows to assignments that carry a copy card, or to those that do not —
   * the copies are a list of their own, and the ones without are what a new
   * copy can be attached to. Absent means both.
   */
  hasCopy: z.enum(["true", "false"]).optional()
    .transform((value) => (value === undefined ? undefined : value === "true"))
});

const cardFieldsSchema = z.object({
  cardNumber: nullableText,
  serialNumber: nullableText,
  cardCode: nullableText,
  balance: balanceSchema.optional(),
  availability: z.boolean().optional(),
  /** A card type (`/card-types`); its settings are the rules the card follows. */
  cardTypeId: uuidSchema.nullable().optional(),
  securityCategory: z.number().int().min(1).max(2).nullable().optional(),
  state: z.number().int().min(0).max(2).optional(),
  swapStatus: z.number().int().nullable().optional(),
  inventoryStatus: z.number().int().min(1).max(3).nullable().optional()
}).strict();

/**
 * The number on the card's front: sixteen digits in groups of four. Typed or
 * pasted with or without the spaces, it is always stored as
 * `0000 0000 0000 0000`, so one card cannot be entered twice in two spellings.
 */
export const cardFrontNumberSchema = z.string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{16}$/, "Front number must be 16 digits, as 0000 0000 0000 0000"))
  .transform((digits) => digits.replace(/(\d{4})(?=\d)/g, "$1 "));

/**
 * A new card starts from the number on its front and its security category;
 * the serial number is bound afterwards, by scanning the physical card.
 */
export const createCardSchema = cardFieldsSchema.extend({
  cardNumber: cardFrontNumberSchema,
  securityCategory: z.number().int().min(1).max(2)
});

export const updateCardSchema = cardFieldsSchema.refine(
  (data) => Object.keys(data).length > 0,
  "At least one field is required"
);

export const createCardCopySchema = z.object({
  clientId: uuidSchema,
  cardId: bigintIdSchema,
  cardCopyId: bigintIdSchema.optional(),
  lastIndex: z.number().int().min(1).optional(),
  pin: pinSchema.optional()
}).strict().refine(
  (data) => data.cardCopyId === undefined || data.cardId !== data.cardCopyId,
  { path: ["cardCopyId"], message: "Copy card must be different from the main card" }
);

export const updateCardCopySchema = z.object({
  clientId: uuidSchema.optional(),
  lastIndex: z.number().int().min(1).optional(),
  pin: pinSchema.optional()
}).strict().refine((data) => Object.keys(data).length > 0, "At least one field is required");

/**
 * The number printed or encoded on the physical card, as scanned or typed. It
 * is what ties a record in the inventory to a card someone can hold, so it is
 * required here — clearing a binding is its own request.
 */
export const bindSerialNumberSchema = z.object({
  serialNumber: z.string().trim().min(1, "Serial number is required").max(100)
}).strict();

/** Query for looking a card up by the number on it, before binding. */
export const serialNumberLookupSchema = z.object({
  serialNumber: z.string().trim().min(1).max(100)
});

export const assignCopyCardSchema = z.object({
  cardCopyId: bigintIdSchema
}).strict();

/**
 * One or more cards to add as copies of an assignment's main card. Each one
 * becomes its own assignment for the same client and main card, numbered on
 * from the copies already there.
 */
export const addCopyCardsSchema = z.object({
  cardCopyIds: z.array(bigintIdSchema).min(1, "At least one copy card is required").max(100)
}).strict().refine(
  (data) => new Set(data.cardCopyIds.map(String)).size === data.cardCopyIds.length,
  { path: ["cardCopyIds"], message: "Copy cards must not repeat" }
);

/**
 * One card being handed to the client. Without `copyOf` it becomes a main
 * card; with it, a copy of that main card — one in the same request, or one
 * the client already holds.
 *
 * Only a main card is given a type. A copy takes its main card's, so any type
 * sent with a copy is ignored.
 */
const assignedCardSchema = z.object({
  cardId: bigintIdSchema,
  cardTypeId: uuidSchema.optional(),
  balance: balanceSchema,
  copyOf: bigintIdSchema.optional()
}).strict();

/**
 * Hands several free cards to one client at once, with the default PIN. The
 * cards are sorted into main cards and copies of them in the same request.
 */
export const assignCardsSchema = z.object({
  clientId: uuidSchema,
  cards: z.array(assignedCardSchema).min(1, "Select at least one card").max(100)
}).strict().superRefine((data, ctx) => {
  const ids = data.cards.map((card) => String(card.cardId));
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["cards"], message: "Cards must not repeat" });
  }
  // A copy hangs off a main card, never off another copy.
  const copies = new Set(data.cards.filter((card) => card.copyOf !== undefined).map((card) => String(card.cardId)));
  data.cards.forEach((card, index) => {
    if (card.copyOf === undefined) {
      if (card.cardTypeId === undefined) {
        ctx.addIssue({ code: "custom", path: ["cards", index, "cardTypeId"], message: "A main card needs a card type" });
      }
      return;
    }
    if (card.copyOf === card.cardId) {
      ctx.addIssue({ code: "custom", path: ["cards", index, "copyOf"], message: "A card cannot be a copy of itself" });
    } else if (copies.has(String(card.copyOf))) {
      ctx.addIssue({ code: "custom", path: ["cards", index, "copyOf"], message: "A copy must be made of a main card, not of another copy" });
    }
  });
});

/** Clients are found by name, email or code. */
export const cardClientQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional()
});

export const cardClientParamsSchema = z.object({ clientId: uuidSchema });

/**
 * A card's transactions, newest first. Without dates the latest page comes
 * back; with them, only what falls between.
 */
export const cardTransactionQuerySchema = paginationQuerySchema.extend({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional()
}).refine(
  ({ startDate, endDate }) => !startDate || !endDate || startDate <= endDate,
  { path: ["endDate"], message: "Start date must be before or equal to end date" }
);

export type CardTransactionQuery = z.infer<typeof cardTransactionQuerySchema>;
export type CardListQuery = z.infer<typeof cardListQuerySchema>;
export type CardCopyListQuery = z.infer<typeof cardCopyListQuerySchema>;
export type BindSerialNumberInput = z.infer<typeof bindSerialNumberSchema>;
export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type CreateCardCopyInput = z.infer<typeof createCardCopySchema>;
export type UpdateCardCopyInput = z.infer<typeof updateCardCopySchema>;
export type AssignCardsInput = z.infer<typeof assignCardsSchema>;
export type CardClientQuery = z.infer<typeof cardClientQuerySchema>;
