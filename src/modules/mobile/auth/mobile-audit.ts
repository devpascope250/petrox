import type { FastifyBaseLogger } from "fastify";

export type MobileAuditEvent =
  | "MOBILE_PROVISIONING_KEY_CREATED"
  | "MOBILE_PROVISIONING_KEY_REVOKED"
  | "MOBILE_DEVICE_PROVISIONED"
  | "MOBILE_DEVICE_REVOKED"
  | "MOBILE_DEVICE_AUTHENTICATED"
  | "MOBILE_PROVISIONING_REJECTED";

/**
 * The backend has no audit-log table, so these go to the structured
 * application log under `audit`. Callers pass ids only — never a key, token
 * or other secret.
 */
export function audit(log: FastifyBaseLogger, event: MobileAuditEvent, details: Record<string, string | number | null | undefined>) {
  log.info({ audit: event, ...details }, event);
}
