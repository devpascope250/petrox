import { z } from "zod";
import { uuidSchema } from "../../../shared/validation/index.js";

/** As the POS sends a phone and PIN on every action an attendant signs for. */
const phoneSchema = z.string().trim().min(3, "Phone number is required").max(30);
const pinSchema = z.string().trim().min(4, "PIN is required").max(12);

/**
 * A meter reading, `DECIMAL(18, 2)`: at most 16 integer digits and 2 decimal
 * places, never negative — a counter does not run backwards.
 */
const indexSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
    "An index must have at most 16 integer digits and 2 decimal places"));

/**
 * Who is asking: the attendant signs with phone and PIN, as they do to confirm
 * a sale. The site comes from the device's own token, never from the body.
 */
export const mobileAttendantSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
}).strict();

/**
 * Closing the shift's counters: the shift being closed, and a reading for each
 * nozzle. One call for the lot — a pump has several nozzles and they are read
 * together, so a dropped connection must not leave half a shift recorded.
 *
 * The attendant comes from the phone and PIN, never from the body: this figure
 * is what the station's cash is reconciled against, so it has to be their own
 * act and not whatever a device claims.
 */
export const recordPumpIndexesSchema = z.object({
  phone: phoneSchema,
  pin: pinSchema,
  /** One of the shifts `/current` says they are working. */
  shiftSiteId: uuidSchema,
  readings: z.array(z.object({
    nozzleId: uuidSchema,
    /** What the counter stands at now. The opening is never sent: it is carried. */
    endIndex: indexSchema,
  }).strict()).min(1, "Send at least one reading").max(20, "Send at most 20 readings"),
}).strict();

export type MobileAttendantInput = z.infer<typeof mobileAttendantSchema>;
export type RecordPumpIndexesInput = z.infer<typeof recordPumpIndexesSchema>;
