import { z } from "zod";
import { nonEmptyNameSchema } from "../../shared/validation/index.js";

const accountCodeSchema = z.string().trim().min(1).max(50);

export const companyAccountParamsSchema = z.object({
  id: z.cuid("Company account id must be a valid CUID")
});

export const createCompanyAccountSchema = z.object({
  code: accountCodeSchema,
  name: nonEmptyNameSchema
});

export const updateCompanyAccountSchema = z.object({
  code: accountCodeSchema.optional(),
  name: nonEmptyNameSchema.optional()
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export type CreateCompanyAccountInput = z.infer<typeof createCompanyAccountSchema>;
export type UpdateCompanyAccountInput = z.infer<typeof updateCompanyAccountSchema>;
