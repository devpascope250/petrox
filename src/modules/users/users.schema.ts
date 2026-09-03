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

const clientDetailsSchema = z.object({
  name: nonEmptyNameSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  idTino: z.string().trim().min(1).max(50).optional(),
  province: uuidSchema.optional(),
  district: uuidSchema.optional(),
  sector: uuidSchema.optional(),
  subsidyAllowed: z.boolean().default(false)
});

const userProfileSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nonEmptyNameSchema,
  lastName: nonEmptyNameSchema,
  position: z.enum(UserPositions),
  phone: phoneSchema.optional(),
  roleId: uuidSchema.nullable().optional()
});

const clientAdminUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.clientAdmin),
  clientDetails: clientDetailsSchema,
  clientId: z.never().optional(),
  siteId: z.never().optional()
});

const clientUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.clientUser),
  clientId: uuidSchema,
  clientDetails: z.never().optional(),
  siteId: z.never().optional()
});

const siteManagerUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.siteManager),
  siteId: uuidSchema,
  clientDetails: z.never().optional(),
  clientId: z.never().optional()
});

const superAdminUserSchema = userProfileSchema.extend({
  position: z.literal(UserPositions.superAdmin),
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

export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  pin: pinSchema.nullable().optional(),
  firstName: nonEmptyNameSchema.optional(),
  lastName: nonEmptyNameSchema.optional(),
  phone: phoneSchema.nullable().optional(),
  position: z.enum(UserPositions).optional(),
  roleId: uuidSchema.nullable().optional()
}).refine((data) => Object.keys(data).length > 0, "At least one field is required");

export const assignUserSiteSchema = z.object({
  siteId: uuidSchema
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AssignUserSiteInput = z.infer<typeof assignUserSiteSchema>;
