import { z } from "zod";
import { nonEmptyNameSchema } from "../../shared/validation/index.js";

export const createCargoSchema = z.object({
  deportId: nonEmptyNameSchema,
  orderId: nonEmptyNameSchema,
  vesselName: nonEmptyNameSchema,
  receivedDate: z.coerce.date(),
  expirationDate: z.coerce.date(),
  quantity: z.coerce.number(),
  blRef: nonEmptyNameSchema,
  supportingDocUrl: z.string().optional().nullable(),
  tansisRef: z.string().optional().nullable(),
  outurnRef: z.string().optional().nullable(),
});

export const fileSchema = z.file().optional().nullable();
export type FileSchema = z.infer<typeof fileSchema>;
export type CreateCargoSchema = z.infer<typeof createCargoSchema>;
