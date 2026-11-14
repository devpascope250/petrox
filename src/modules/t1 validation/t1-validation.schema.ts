import { z } from "zod";
import {
  nonEmptyNameSchema, pagedDatesQuerySchema, paginationQuerySchema, uuidSchema,
} from "../../shared/validation/index.js";

/**
 * One page of T1 validations in a window.
 *
 * `search` is matched against the **ship** the fuel came in on
 * (`Cargo.vesselName`) and its BL, the declaration reference, the exporting
 * country, and the trip's driver, plate, trailer and destination. A T1 is
 * recognised by its vessel more than by anything else, which is why the search
 * reaches two relations down to find it.
 */
export const t1ListQuerySchema = pagedDatesQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});

export type T1ListQuery = z.infer<typeof t1ListQuerySchema>;

export const createT1ValidationsSchema = z.object({
  nominationId: uuidSchema,
  exportingCountry: nonEmptyNameSchema,
  customOffice:   nonEmptyNameSchema,
  // transitNumbering: nonEmptyNameSchema,
  quantityAt20C: z.coerce.number(),
  /**
   * The shipment this T1's fuel came off, for reference.
   *
   * **It changes no arithmetic.** The litres are drawn from the batches the
   * nomination names, apportioned across them as always; this only records
   * which vessel the load is said to have come from, so a T1 loaded off a
   * different cargo than the trip drew on can be seen rather than inferred.
   *
   * Optional, and emptied rather than stored blank when the form sends "".
   */
  cargoId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => value || null),
  /**
   * The ambient litres to put on the trip for `cargoId`, when the trip has not
   * nominated that shipment at all.
   *
   * A truck that topped up from a second cargo did two things: it drew fuel off
   * that batch, and it was cleared on a T1 for it. Naming the shipment records
   * the second; this records the first, by adding the vessel line the trip was
   * missing. Without it the litres would come off the batch the trip *had*
   * nominated, which is the wrong fuel.
   *
   * Ignored when the trip already has a line on that shipment — then there is
   * nothing to add. Omitted, the T1's own figure is used: the best estimate
   * available of what went in, and the only one anybody has at the border.
   */
  cargoAmbQuantity: z.coerce.number().positive().optional(),
  /**
   * The reference on the customs declaration this T1 was cleared under.
   * Optional: a trip may be recorded before its declaration comes back, and
   * every row entered before this field existed has none.
   */
  sdReference: z.string().trim().max(120).optional().transform((value) => value || null),
  supportingDocUrl: z.string().optional().nullable(),
  createdBy: z.string().optional()
});


export const createExtraT1ValidationsSchema = z.object({
  t1ValidationId: uuidSchema,
  customOffice:   nonEmptyNameSchema,
  transitNumbering: nonEmptyNameSchema,
});

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateT1ValidationsSchema = z.infer<typeof createT1ValidationsSchema>;
export type CreateExtraT1ValidationsSchema = z.infer<typeof createExtraT1ValidationsSchema>;
/* ------------------------------------------------------------------------- *
 * Finding the trip to raise a T1 against
 *
 * A clerk raising a T1 is holding a customs document, not looking at a screen.
 * The document names the order the fuel was bought under, the ship it came off
 * and its BL, the truck, and the quantity at 20 °C — so the trip is found the
 * way the paper reads: order, then truck, then the trip itself.
 *
 * None of these take a date window, which is the point of them. `GET
 * /nominations` defaults to the **last two days**, and a T1 comes back from the
 * border long after the trip was nominated — so the trip wanted is usually not
 * in that window at all, and no amount of looking through the list finds it.
 * ------------------------------------------------------------------------- */

/** Orders that have fuel on the road: step one of finding a trip. */
export const t1RaiseOrdersQuerySchema = paginationQuerySchema.extend({
  /** An order code or name, its supplier, or its product. */
  search: z.string().trim().max(100).optional(),
});

/** The trucks nominated on an order's shipments: step two. */
export const t1RaiseVehiclesQuerySchema = paginationQuerySchema.extend({
  /**
   * The order to look inside. Optional: a clerk reading a plate off the
   * document can skip straight past the order, which is the field they are
   * least likely to have.
   */
  orderId: uuidSchema.optional(),
  /** A plate, trailer, truck number or driver's name. */
  search: z.string().trim().max(100).optional(),
});

/** The trips themselves: step three, and where a T1 is raised from. */
export const t1RaiseTripsQuerySchema = paginationQuerySchema.extend({
  orderId: uuidSchema.optional(),
  /** The driver-and-vehicle assignment, as step two returns it. */
  driverVehicleId: uuidSchema.optional(),
  /**
   * One box for a clerk who knows what they are looking for: a plate, trailer,
   * driver, destination, the ship, its BL, or the order's code. This is what
   * lets the paper be typed in directly instead of walked down.
   */
  search: z.string().trim().max(100).optional(),
  /**
   * `true` leaves out the trips that already have a live T1 — the common case,
   * since most trips are cleared once. Left off, every trip comes back: a load
   * split across two declarations needs the second one raised against a trip
   * that already has one.
   */
  /*
   * Not `z.coerce.boolean()`: a query string carries "false", and
   * `Boolean("false")` is `true` — the filter would be impossible to turn off
   * from a URL. Read as the words a query string actually sends.
   */
  withoutT1: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .optional()
    .transform((value) => value === true || value === "true" || value === "1"),
});

export type T1RaiseOrdersQuery = z.infer<typeof t1RaiseOrdersQuerySchema>;
export type T1RaiseVehiclesQuery = z.infer<typeof t1RaiseVehiclesQuerySchema>;
export type T1RaiseTripsQuery = z.infer<typeof t1RaiseTripsQuerySchema>;
