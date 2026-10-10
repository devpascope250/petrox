import type { AuthUser } from "../../shared/auth/context-user.js";
import { forbidden } from "../../utils/errors.js";

/**
 * Who may manage shifts, and where.
 *
 * A super administrator works across every site. A site manager works only on
 * his own site. Nobody else manages shifts, whatever permissions they hold.
 */

/** The site a caller is limited to, or `undefined` for every site. */
export function siteScope(actor: AuthUser): string | undefined {
  if (actor.position === "superAdmin") return undefined;
  if (actor.position === "siteManager") {
    if (!actor.siteId) throw forbidden("Your user account is not assigned to an active site");
    return actor.siteId;
  }
  throw forbidden("Only super administrators and site managers can manage shifts");
}

/** Refuses a site the caller does not manage. */
export function assertSiteAccess(siteId: string, actor: AuthUser) {
  const scoped = siteScope(actor);
  if (scoped && scoped !== siteId) {
    throw forbidden("You can only manage shifts for your own site");
  }
}

/** A shift and its hours are shared by every site, so only head office changes them. */
export function assertSuperAdmin(actor: AuthUser) {
  if (actor.position !== "superAdmin") {
    throw forbidden("Only super administrators can create or change shifts");
  }
}

/*
 * `startAt` / `endAt` are MySQL TIME columns. Prisma reads and writes them as a
 * Date on 1970-01-01 (UTC), so the API speaks plain "HH:mm" and converts here.
 */

/** "06:30" → 1970-01-01T06:30:00Z */
export function toTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

/** 1970-01-01T06:30:00Z → "06:30" */
export function fromTime(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/** "2026-10-05" → the date at midnight UTC, for a MySQL DATE column. */
export function toDate(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T00:00:00.000Z`);
}

/** A DATE column back to "2026-10-05". */
export function fromDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Day of the week, 1 = Monday … 7 = Sunday. */
export function dayOfWeek(value: Date): number {
  return ((value.getUTCDay() + 6) % 7) + 1;
}

/**
 * A shift as other records nest it: its name and its hours. The hours live on
 * the shift itself, so they are the same at every site that runs it.
 */
export const shiftWithHours = { select: { id: true, name: true, startAt: true, endAt: true } } as const;

/** The nested shift with its TIME columns turned into "HH:mm". */
export function presentShift<T extends { startAt: Date; endAt: Date }>(shift: T) {
  return { ...shift, startAt: fromTime(shift.startAt), endAt: fromTime(shift.endAt) };
}
