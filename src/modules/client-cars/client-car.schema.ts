import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A plate as written on the car, kept in one form so the same plate typed two
 * ways is still one car: upper case, without spaces or dashes ("rad 123-a" →
 * "RAD123A").
 */
export function normalizePlate(raw: string) {
  return raw.toUpperCase().replace(/[\s-]+/g, "");
}

const plateSchema = z.string().trim().min(2, "Plate number is required").max(20, "Plate number is too long")
  .transform(normalizePlate)
  .refine((plate) => /^[A-Z0-9]{2,15}$/.test(plate), "Plate number may only contain letters and digits");

/**
 * A yes/no field. A JSON body sends a real boolean, a form sends the string,
 * and `z.coerce.boolean()` would read `"false"` as true — so both are spelled
 * out, as `printStatus` does on the POS sales.
 */
const flagSchema = z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional();

/** The car fields, shared by the car form and the client form that can add cars. */
export const carFieldsSchema = z.object({
  plateNo: plateSchema,
  /** The product the car runs on, e.g. AGO or PMS. */
  itemId: uuidSchema,
  /** The tracker's number, when the car has one. */
  trackNo: z.string().trim().max(50, "Tracker number is too long").nullable().optional()
    .transform((value) => value || null),
  /** The car's tank, in the product's base unit. */
  tancapacity: z.coerce.number("Tank capacity must be a number").positive("Tank capacity must be more than zero")
    .max(1_000_000, "Tank capacity is too large"),
  /**
   * Whether this car may earn the product's subsidy. The client must be
   * allowed one as well, and the car only earns it on the product it takes.
   */
  subsidyAllowed: flagSchema.default(false),
});

export const createClientCarSchema = carFieldsSchema.extend({ clientId: uuidSchema });

export const updateClientCarSchema = z.object({
  plateNo: plateSchema.optional(),
  itemId: uuidSchema.optional(),
  trackNo: z.string().trim().max(50, "Tracker number is too long").nullable().optional()
    .transform((value) => value === undefined ? undefined : value || null),
  tancapacity: carFieldsSchema.shape.tancapacity.optional(),
  subsidyAllowed: flagSchema,
}).refine((data) => Object.values(data).some((value) => value !== undefined), "At least one field is required");

export const clientCarListQuerySchema = paginationQuerySchema.extend({
  clientId: uuidSchema.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  /** Matches plate or tracker number. */
  search: z.string().trim().max(50).optional(),
});

const cardCopyIdSchema = z.coerce.bigint().positive("Choose a card");

export const assignCardsSchema = z.object({
  /** The client's cards (`CardCopy`) to put on the car. */
  cardCopyIds: z.array(cardCopyIdSchema).min(1, "Choose at least one card").max(50, "Choose at most 50 cards"),
}).strict();

export const carCardParamsSchema = z.object({ id: uuidSchema, cardCopyId: cardCopyIdSchema });

export const clientSearchSchema = z.object({ search: z.string().trim().max(80).optional() });

export const clientParamsSchema = z.object({ clientId: uuidSchema });

export type CarFields = z.infer<typeof carFieldsSchema>;
export type CreateClientCar = z.infer<typeof createClientCarSchema>;
export type UpdateClientCar = z.infer<typeof updateClientCarSchema>;
export type ClientCarListQuery = z.infer<typeof clientCarListQuerySchema>;
