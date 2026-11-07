import { z } from "zod";
import { nonEmptyNameSchema, paginationQuerySchema, uuidSchema } from "../../shared/validation/index.js";

/**
 * A short code people type, import by and read on a form.
 *
 * Upper-cased and stripped of inner spaces so the uniqueness the database
 * enforces matches what a person would call the same code: `fin 01` and
 * `FIN01` must not be two departments.
 */
const codeSchema = z.string()
  .trim()
  .min(2, "Must contain at least 2 characters")
  .max(20, "Must contain at most 20 characters")
  .transform((value) => value.replace(/\s+/g, "").toUpperCase());

export const createDepartmentSchema = z.object({
  departmentName: nonEmptyNameSchema,
  departmentCode: codeSchema,
  description: z.string().trim().min(1, "Description is required").max(255)
});

export const createOfficeSchema = z.object({
  officeName: nonEmptyNameSchema,
  officeCode: codeSchema,
  departmentId: uuidSchema
});

/** Both lists page, search and filter by status; they only ever grow. */
const listQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  status: z.enum(["active", "inactive"]).optional()
});

export const departmentListQuerySchema = listQuerySchema;

export const officeListQuerySchema = listQuerySchema.extend({
  /** Narrows the list to one department, for the drill-down from a department. */
  departmentId: uuidSchema.optional()
});

export type CreateDepartmentSchema = z.infer<typeof createDepartmentSchema>;
export type CreateOfficeSchema = z.infer<typeof createOfficeSchema>;
export type DepartmentListQuery = z.infer<typeof departmentListQuerySchema>;
export type OfficeListQuery = z.infer<typeof officeListQuerySchema>;
