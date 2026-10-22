import { z } from "zod";
import { nonEmptyNameSchema, pagedDatesQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/** One vessel (stock receipt) a nomination draws from, with its own volume. */
export const nominationVesselSchema = z.object({
  stockId: uuidSchema,
  ambQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
});

export const createNominationsSchema = z.object({
    driverVehicleId: uuidSchema,
    destination: nonEmptyNameSchema,
    expectedLoadingedDate: z.coerce.date("Please provide expected date."),
    createdBy: z.string().optional(),
    /**
     * The vessels this nomination loads from. The nomination's own
     * `ambQuantity` is their total, so it is never sent by a client.
     */
    vessels: z.array(nominationVesselSchema).min(1, "At least one vessel is required").optional(),
    /** @deprecated Single-vessel form, kept so older clients keep working. */
    stockId: uuidSchema.optional(),
    /** @deprecated Single-vessel form; use `vessels`. */
    ambQuantity: z.coerce.number().positive().optional(),
  })
  .superRefine((value, context) => {
    const vessels = value.vessels
      ?? (value.stockId && value.ambQuantity !== undefined
        ? [{ stockId: value.stockId, ambQuantity: value.ambQuantity }]
        : []);
    if (vessels.length === 0) {
      context.addIssue({ code: "custom", message: "At least one vessel is required", path: ["vessels"] });
      return;
    }
  })
  .transform(({ vessels, stockId, ambQuantity, ...rest }) => ({
    ...rest,
    // A stock is unique per nomination, so a stock named twice in one request
    // is one vessel carrying the total rather than an error.
    vessels: mergeVessels(vessels ?? [{ stockId: stockId!, ambQuantity: ambQuantity! }]),
  }));

/** One vessel per stock, quantities summed, in first-mentioned order. */
export function mergeVessels(vessels: NominationVesselSchema[]): NominationVesselSchema[] {
  const merged = new Map<string, NominationVesselSchema>();
  for (const vessel of vessels) {
    const existing = merged.get(vessel.stockId);
    if (existing) existing.ambQuantity += vessel.ambQuantity;
    else merged.set(vessel.stockId, { ...vessel });
  }
  return Array.from(merged.values());
}

/**
 * Body of `POST /nominations/:id/vessels` — the stock to load onto an existing
 * nomination. Takes a list, or a single vessel for convenience.
 */
export const addNominationVesselSchema = z.union([
  z.object({ vessels: z.array(nominationVesselSchema).min(1, "At least one vessel is required") }),
  nominationVesselSchema,
]).transform((value) => ("vessels" in value ? mergeVessels(value.vessels) : [value]));

/**
 * Query for `GET /nominations`: one page of the list, narrowed by the window
 * and the filters below. A window alone would still return everything in it.
 */
export const nominationListQuerySchema = pagedDatesQuerySchema.extend({
  itemId: uuidSchema.optional(),
});

export type NominationListQuerySchema = z.infer<typeof nominationListQuerySchema>;
export type AddNominationVesselSchema = z.infer<typeof addNominationVesselSchema>;

export type NominationVesselSchema = z.infer<typeof nominationVesselSchema>;
export type CreateNominationsSchema = z.infer<typeof createNominationsSchema>;
