import { z } from "zod";
import { UserPositions } from "../../../prisma/generated/prisma/enums.js";
import {
  emailSchema,
  nonEmptyNameSchema,
  passwordSchema,
  phoneSchema,
  pinSchema,
  uuidSchema
} from "../../shared/validation/index.js";
import { carFieldsSchema } from "../client-cars/client-car.schema.js";

const clientDetailsSchema = z.object({
  name: nonEmptyNameSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  idTino: z.string().trim().min(1).max(50).optional(),
  province: uuidSchema.optional(),
  district: uuidSchema.optional(),
  sector: uuidSchema.optional(),
  subsidyAllowed: z.boolean().default(false),
  /** The client's PIN (4–8 digits), entered at the pump to pay with its coupons. */
  pin: pinSchema.optional()
});

const userProfileSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nonEmptyNameSchema,
  lastName: nonEmptyNameSchema,
  position: z.enum(UserPositions),
  phone: phoneSchema.optional(),
  /** Their PIN (4–8 digits). Left out, one is generated and returned once as `temporaryPin`. */
  pin: pinSchema.optional(),
  roleId: uuidSchema.nullable().optional()
});

const clientAdminUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.clientAdmin),
  clientDetails: clientDetailsSchema,
  /** Cars registered with the new client, in the same go. */
  cars: z.array(carFieldsSchema).max(50, "Add at most 50 cars at once").optional(),
  clientId: z.never().optional(),
  siteId: z.never().optional()
});

const clientUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.clientUser),
  cars: z.never().optional(),
  clientId: uuidSchema,
  clientDetails: z.never().optional(),
  siteId: z.never().optional()
});

const siteManagerUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.siteManager),
  cars: z.never().optional(),
  siteId: uuidSchema,
  clientDetails: z.never().optional(),
  clientId: z.never().optional()
});

const superAdminUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.superAdmin),
  cars: z.never().optional(),
  clientDetails: z.never().optional(),
  clientId: z.never().optional(),
  siteId: z.never().optional()
});

/** Users managed independently from a client account. */
export const createStaffUserSchema = z.discriminatedUnion("position", [
  siteManagerUserSchema,
  superAdminUserSchema
]);

/** A new client administrator, or a user attached to an existing client. */
export const createClientUserSchema = z.discriminatedUnion("position", [
  clientAdminUserSchema,
  clientUserSchema
]);

export const createUserSchema = z.discriminatedUnion("position", [
  clientAdminUserSchema,
  clientUserSchema,
  siteManagerUserSchema,
  superAdminUserSchema
]);

/**
 * The client company's own details when editing. Every field is optional and
 * none carries a default, so a partial edit cannot silently reset a field the
 * caller left out — unlike the create schema, where `subsidyAllowed` defaults.
 */
const updateClientDetailsSchema = z.object({
  name: nonEmptyNameSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  idTino: z.string().trim().min(1).max(50).optional(),
  province: uuidSchema.optional(),
  district: uuidSchema.optional(),
  sector: uuidSchema.optional(),
  subsidyAllowed: z.boolean().optional(),
  status: z.boolean().optional(),
  /** A new client PIN; `null` removes it, so its coupons can no longer pay at the pump. */
  pin: pinSchema.nullable().optional()
}).refine((data) => Object.keys(data).length > 0, "At least one client detail is required");

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  pin: pinSchema.nullable().optional(),
  firstName: nonEmptyNameSchema.optional(),
  lastName: nonEmptyNameSchema.optional(),
  phone: phoneSchema.nullable().optional(),
  roleId: uuidSchema.nullable().optional(),
  clientDetails: updateClientDetailsSchema.optional()
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const assignUserSiteSchema = z.object({
  siteId: uuidSchema
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateClientDetailsInput = z.infer<typeof updateClientDetailsSchema>;
export type AssignUserSiteInput = z.infer<typeof assignUserSiteSchema>;
