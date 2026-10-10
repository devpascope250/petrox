import { z } from "zod";
import { CardLimitPeriod } from "../../../prisma/generated/prisma/enums.js";
import { nonEmptyNameSchema } from "../../shared/validation/index.js";

/**
 * The rules every card of a type follows. All switches; a limit also needs
 * its amount and period.
 */
export const cardSettingSchema = z.object({
  requirePin: z.boolean().default(true),
  requirePlateNumber: z.boolean().default(false),
  capturePlatePicture: z.boolean().default(false),
  requireOdometer: z.boolean().default(false),
  /** The card's balance may be shown to the holder (on the POS screen and receipt). */
  showBalance: z.boolean().default(true),
  /** A picture of the pump's display must be taken. */
  captureDisplay: z.boolean().default(false),
  allowCredit: z.boolean().default(false),
  hasLimit: z.boolean().default(false),
  limitAmount: z.coerce.number("Limit must be a number").positive("Limit must be more than zero").nullable().optional(),
  limitPeriod: z.enum(CardLimitPeriod).nullable().optional(),
}).superRefine((setting, ctx) => {
  if (!setting.hasLimit) return;
  if (!setting.limitAmount) ctx.addIssue({ code: "custom", path: ["limitAmount"], message: "Enter the limit amount" });
  if (!setting.limitPeriod) ctx.addIssue({ code: "custom", path: ["limitPeriod"], message: "Choose what the limit applies to" });
});

const descriptionSchema = z.string().trim().max(190).nullable().optional();

export const createCardTypeSchema = z.object({
  name: nonEmptyNameSchema,
  description: descriptionSchema,
  /** Left out, the type starts with the defaults: PIN required, everything else off. */
  setting: cardSettingSchema.optional(),
});

export const updateCardTypeSchema = z.object({
  name: nonEmptyNameSchema.optional(),
  description: descriptionSchema,
  setting: cardSettingSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export type CardSettingInput = z.infer<typeof cardSettingSchema>;
export type CreateCardType = z.infer<typeof createCardTypeSchema>;
export type UpdateCardType = z.infer<typeof updateCardTypeSchema>;
