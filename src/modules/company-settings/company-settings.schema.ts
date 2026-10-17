import { z } from "zod";

/**
 * Left out, a field keeps what it holds; sent blank (or null), it is cleared —
 * stored as null rather than an empty string. So a save with just a new logo
 * touches nothing else.
 */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable()
    .transform((value) => (value === undefined ? undefined : value || null));

/**
 * The company profile, as saved from the web. Sent as JSON, or as multipart
 * form fields when a `logo` file comes with it. `removeLogo` drops the current one.
 */
export const companySettingsSchema = z.object({
  companyName: z.string().trim().min(1, "The company name is required").max(120),
  address: optionalText(255),
  phone: optionalText(40),
  email: z.union([z.literal(""), z.null(), z.email("Must be a valid email")]).optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
  taxId: optionalText(40),
  website: optionalText(191),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. RWF"),
  receiptFooter: optionalText(255),
  removeLogo: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
}).strict();

export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
