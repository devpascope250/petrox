import { z } from "zod";
import {
  nonEmptyNameSchema,
  uuidSchema,
} from "../../shared/validation/index.js";
export const createPfiSchema = z.object({
  nominationId: uuidSchema,
  currencyId: uuidSchema,
  currancyCode: nonEmptyNameSchema,
  amount: z.coerce.number(),
  pfiReference: nonEmptyNameSchema,
  rate: z.coerce.number()
});

export const createCurrancySchema = z.object({
  code: nonEmptyNameSchema,
  name: nonEmptyNameSchema,
  rate: z.coerce.number()
});

export type CreateCurrancySchema = z.infer<typeof createCurrancySchema>;
export type CreatePfiSchema = z.infer<typeof createPfiSchema>;
