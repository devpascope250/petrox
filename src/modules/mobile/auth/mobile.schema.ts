import { z } from "zod";
import { uuidSchema } from "../../../shared/validation/index.js";

export const siteParamsSchema = z.object({ siteId: uuidSchema });
export const keyParamsSchema = z.object({ keyId: uuidSchema });
export const deviceParamsSchema = z.object({ deviceId: uuidSchema });

/** The upper bound comes from config (`MOBILE_PROVISIONING_KEY_MAX_MINUTES`), checked in the service. */
export const createProvisioningKeySchema = z.object({
  expiresInMinutes: z.coerce.number("Must be a number of minutes").int("Must be whole minutes")
    .min(1, "Must be at least 1 minute").default(10),
}).strict();

/** What the device reports about itself: an identifier, not a secret. */
const deviceUuidSchema = z.string().trim()
  .min(8, "Device UUID is too short").max(128, "Device UUID is too long")
  .regex(/^[A-Za-z0-9._:-]+$/, "Device UUID may only contain letters, digits and . _ : -");

export const provisionDeviceSchema = z.object({
  /** As shown to the admin; spaces, dashes and case are ignored. */
  provisioningKey: z.string().trim().min(8, "Invalid or expired provisioning key").max(40, "Invalid or expired provisioning key"),
  deviceUuid: deviceUuidSchema,
  deviceName: z.string().trim().min(1, "Device name is required").max(80, "Device name is too long"),
}).strict();

export const refreshDeviceSchema = z.object({
  refreshToken: z.string().min(32, "Invalid device credential").max(512, "Invalid device credential"),
}).strict();

/**
 * A device never chooses its site. A `siteId` sent anyway is only checked
 * against the device's own and refused if it differs.
 */
export const deviceSiteQuerySchema = z.object({ siteId: uuidSchema.optional() });

/** The version of the site data the POS holds; left out, the full data comes back. */
export const syncQuerySchema = z.object({
  version: z.string().trim().regex(/^[0-9a-f]{32}$/, "Unknown version").optional(),
  siteId: uuidSchema.optional(),
});

export type CreateProvisioningKeyInput = z.infer<typeof createProvisioningKeySchema>;
export type ProvisionDeviceInput = z.infer<typeof provisionDeviceSchema>;
