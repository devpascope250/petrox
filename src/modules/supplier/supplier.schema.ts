import { z } from "zod";
import { nonEmptyNameSchema} from "../../shared/validation/index.js";

export const createSupplierSchema = z.object({
    name: nonEmptyNameSchema,
    phone: nonEmptyNameSchema,
    address: z.string().optional().nullable(),
    tinNumber: z.string().optional().nullable(),
    supplierTypeId: nonEmptyNameSchema
  });

export const createSupplierTypeSchema = z.object({
    type: nonEmptyNameSchema
});

export type CreateSupplierTypeSchema = z.infer<typeof createSupplierTypeSchema>;

export type CreateSupplierSchema = z.infer<typeof createSupplierSchema>;