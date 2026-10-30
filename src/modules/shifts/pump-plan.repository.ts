import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { presentShift, shiftWithHours, toDate } from "./shift-scope.js";
import type { PumpPlanQuerySchema } from "./pump-plan.schema.js";

/** `TblTimeTable.status`: 0 planned, 1 present, 2 absent. */
const ABSENT = 2;

const planSelect = {
  id: true, siteId: true, siteShiftId: true, userId: true, pumpId: true,
  weekday: true, status: true, createdAt: true, updatedAt: true,
  site: { select: { id: true, name: true } },
  pump: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
  siteShift: { select: { id: true, shift: shiftWithHours } },
  nozzles: {
    select: {
      id: true,
      nozzle: { select: { id: true, name: true, nozzleCode: true,
        cuve: { select: { id: true, name: true, item: { select: { id: true, name: true } } } } } },
    },
  },
} as const;

type Row = Prisma.PumpAttendantPlanGetPayload<{ select: typeof planSelect }>;

/** The shift's hours go out as "HH:mm", as everywhere else. */
function present(row: Row) {
  return { ...row, siteShift: { ...row.siteShift, shift: presentShift(row.siteShift.shift) } };
}

/**
 * The standing arrangements, and the work of putting them into effect: a plan
 * is read whenever someone is rostered, and its pump assignment written for
 * that date.
 */
export class PumpPlanRepository {
  constructor(private db: PrismaClient) {}

  async list(query: PumpPlanQuerySchema & { siteId?: string }) {
    const rows = await this.db.pumpAttendantPlan.findMany({
      where: {
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.siteShiftId && { siteShiftId: query.siteShiftId }),
        ...(query.userId && { userId: query.userId }),
        ...(query.pumpId && { pumpId: query.pumpId }),
        ...(query.weekday && { weekday: query.weekday }),
        ...(query.status && { status: query.status }),
      },
      orderBy: [{ weekday: "asc" }, { siteShift: { shift: { startAt: "asc" } } }, { pump: { name: "asc" } }],
      select: planSelect,
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.pumpAttendantPlan.findUnique({ where: { id }, select: planSelect });
    return row ? present(row) : null;
  }

  /** One plan per weekday, each with its own nozzles; `skipDuplicates` lets a re-save be harmless. */
  async create(input: {
    siteId: string; siteShiftId: string; userId: string; pumpId: string;
    nozzleIds: string[]; weekdays: number[]; status: "active" | "inactive"; createdBy: string;
  }) {
    const ids = await this.db.$transaction(async (tx) => {
      const written: string[] = [];
      for (const weekday of [...new Set(input.weekdays)].sort()) {
        const existing = await tx.pumpAttendantPlan.findFirst({
          where: { siteShiftId: input.siteShiftId, userId: input.userId, weekday, pumpId: input.pumpId },
          select: { id: true },
        });
        // Saving the same weekday again replaces its nozzles rather than
        // failing: the form is "this is the arrangement", not an append.
        if (existing) {
          await tx.pumpAttendantPlanNozzle.deleteMany({ where: { planId: existing.id } });
          await tx.pumpAttendantPlan.update({
            where: { id: existing.id },
            data: { status: input.status,
              nozzles: { create: [...new Set(input.nozzleIds)].map((nozzleId) => ({ nozzleId })) } },
          });
          written.push(existing.id);
          continue;
        }
        const row = await tx.pumpAttendantPlan.create({
          data: {
            siteId: input.siteId, siteShiftId: input.siteShiftId, userId: input.userId,
            pumpId: input.pumpId, weekday, status: input.status, createdBy: input.createdBy,
            nozzles: { create: [...new Set(input.nozzleIds)].map((nozzleId) => ({ nozzleId })) },
          },
          select: { id: true },
        });
        written.push(row.id);
      }
      return written;
    });
    const rows = await this.db.pumpAttendantPlan.findMany({
      where: { id: { in: ids } }, orderBy: { weekday: "asc" }, select: planSelect,
    });
    return rows.map(present);
  }

  async update(id: string, data: { pumpId?: string; weekday?: number; status?: "active" | "inactive"; nozzleIds?: string[] }) {
    const row = await this.db.$transaction(async (tx) => {
      if (data.nozzleIds) await tx.pumpAttendantPlanNozzle.deleteMany({ where: { planId: id } });
      return tx.pumpAttendantPlan.update({
        where: { id },
        data: {
          ...(data.pumpId && { pumpId: data.pumpId }),
          ...(data.weekday && { weekday: data.weekday }),
          ...(data.status && { status: data.status }),
          ...(data.nozzleIds && {
            nozzles: { create: [...new Set(data.nozzleIds)].map((nozzleId) => ({ nozzleId })) },
          }),
        },
        select: planSelect,
      });
    });
    return present(row);
  }

  delete(id: string) {
    // The nozzles cascade: they are part of the plan, not records of their own.
    return this.db.pumpAttendantPlan.delete({ where: { id }, select: { id: true } });
  }

  /**
   * The roster days a plan reaches: this person, this shift, that weekday,
   * from `from` onward, not marked absent.
   */
  rosterDaysFor(plan: { userId: string; siteShiftId: string; weekday: number }, from: string) {
    return this.db.tblTimeTable.findMany({
      where: {
        userId: plan.userId, siteShiftId: plan.siteShiftId, days: plan.weekday,
        dateOn: { gte: toDate(from) }, status: { not: ABSENT },
      },
      select: { id: true, dateOn: true },
    });
  }

  /**
   * The plans that fit a roster row — the person, the shift and the weekday it
   * falls on — active only. This is what turns "rostered" into "on a pump".
   */
  plansFor(roster: { userId: string; siteShiftId: string; days: number }) {
    return this.db.pumpAttendantPlan.findMany({
      where: { userId: roster.userId, siteShiftId: roster.siteShiftId, weekday: roster.days, status: "active" },
      select: { id: true, pumpId: true, nozzles: { select: { nozzleId: true } } },
    });
  }

  /**
   * Writes an arrangement onto every rostered day it reaches from `from`:
   * this person, this shift, that weekday. What "apply the plan to the days
   * already rostered" does.
   */
  async applyFrom(
    plan: { id: string; userId: string; siteShiftId: string; weekday: number; pumpId: string; nozzleIds: string[] },
    from: string,
    replace: boolean,
  ) {
    const rows = await this.rosterDaysFor(plan, from);
    return this.applyTo(this.db, plan, rows.map((row) => row.id), replace);
  }

  /**
   * Writes a plan onto roster rows, one pump assignment each.
   *
   * Three cases, and the middle one is the point of the stamp:
   *
   * - the day carries **this plan's own row** — `replace` moves it to the
   *   plan's pump and nozzles (the rotation), otherwise it is left alone;
   * - the day carries **something else** — another pump, or one somebody set
   *   by hand — and is skipped entirely. A plan fills a day in; it does not
   *   argue with an arrangement a person made;
   * - the day carries **nothing**, and the plan writes it.
   */
  async applyTo(
    db: Prisma.TransactionClient | PrismaClient,
    plan: { id: string; pumpId: string; nozzleIds: string[] },
    rosterIds: string[],
    replace = false,
  ) {
    let written = 0;
    let replaced = 0;
    let skipped = 0;
    for (const timeTableId of rosterIds) {
      const onDay = await db.tblPumpAttendant.findMany({
        where: { timeTableId }, select: { id: true, pumpId: true, fromPlanId: true },
      });
      const own = onDay.find((row) => row.fromPlanId === plan.id);
      if (own) {
        if (!replace) continue;
        // The pump it is moving to may already sit on that day as another row;
        // the unique key would refuse it, and two rows for one pump is not
        // what was asked for anyway.
        if (onDay.some((row) => row.id !== own.id && row.pumpId === plan.pumpId)) {
          skipped += 1;
          continue;
        }
        await db.pumpAttendantNozzle.deleteMany({ where: { pumpAttendantId: own.id } });
        await db.tblPumpAttendant.update({
          where: { id: own.id },
          data: {
            pumpId: plan.pumpId,
            pumpAttendantNozzles: { create: plan.nozzleIds.map((nozzleId) => ({ nozzleId })) },
          },
        });
        replaced += 1;
        continue;
      }
      if (onDay.length > 0) {
        skipped += 1;
        continue;
      }
      await db.tblPumpAttendant.create({
        data: {
          timeTableId, pumpId: plan.pumpId, fromPlanId: plan.id,
          pumpAttendantNozzles: { create: plan.nozzleIds.map((nozzleId) => ({ nozzleId })) },
        },
      });
      written += 1;
    }
    return { written, replaced, skipped };
  }
}
