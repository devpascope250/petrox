import { z } from "zod";
import { CompanyAccountType } from "../../../prisma/generated/prisma/enums.js";
import { nonEmptyNameSchema, uuidSchema } from "../../shared/validation/index.js";

const accountCodeSchema = z.string().trim().min(1).max(50);

export const companyAccountParamsSchema = z.object({
  id: z.cuid("Company account id must be a valid CUID")
});

/**
 * Where money lands: a cash drawer, a bank account, mobile money, a transfer
 * or a card terminal.
 *
 * `siteId` ties the account to one site (e.g. that site's cash drawer); left
 * out, it belongs to the whole company. `requiredReference` means a payment
 * into it must carry a reference number, as mobile money and bank payments do.
 */
export const createCompanyAccountSchema = z.object({
  code: accountCodeSchema,
  name: nonEmptyNameSchema,
  type: z.enum(CompanyAccountType),
  siteId: uuidSchema.nullable().optional(),
  requiredReference: z.boolean().default(false)
});

export const updateCompanyAccountSchema = z.object({
  code: accountCodeSchema.optional(),
  name: nonEmptyNameSchema.optional(),
  type: z.enum(CompanyAccountType).optional(),
  // `null` moves the account back to the whole company.
  siteId: uuidSchema.nullable().optional(),
  requiredReference: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export type CreateCompanyAccountInput = z.infer<typeof createCompanyAccountSchema>;
export type UpdateCompanyAccountInput = z.infer<typeof updateCompanyAccountSchema>;
