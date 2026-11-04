import { z } from "zod";
import { nonEmptyNameSchema } from "../../../shared/validation/primitives.js";

/**
 * A tax a clearance can be charged, by code.
 *
 * No amount: the same tax is a different figure on every load, so what it
 * comes to is typed on the clearance itself. This is a catalogue and nothing
 * more.
 */
export const createTaxDescriptionSchema = z.object({
  code: nonEmptyNameSchema,
  description: z.string().trim().max(255).optional(),
});

export type CreateTaxDescriptionSchema = z.infer<typeof createTaxDescriptionSchema>;
