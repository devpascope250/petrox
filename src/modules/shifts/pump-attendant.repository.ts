import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import type {
  CreatePumpAttendantSchema, PumpAttendantQuerySchema, UpdatePumpAttendantSchema,
} from "./pump-attendant.schema.js";
import { fromDate, presentShift, shiftWithHours, toDate } from "./shift-scope.js";

/** `TblTimeTable.status`: 0 planned, 1 present, 2 absent. */
const ABSENT = 2;

/**
 * A rota row reads everything but its pump from the roster row it hangs off:
 * who, which shift, which site and which day.
 */
const pumpAttendantSelect = {
  id: true,
  pumpId: true,
  timeTableId: true,
  fromPlanId: true,
  createdAt: true,
  pump: { select: { id: true, name: true } },
  timeTable: {
    select: {
      id: true, dateOn: true, status: true, isChief: true, isSuport: true, extraShift: true,
      siteId: true, siteShiftId: true, userId: true,
      site: { select: { id: true, name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      shiftSite: { select: { id: true, shift: shiftWithHours } },
    },
  },
  pumpAttendantNozzles: {
    select: {
      id: true,
      nozzle: {
        select: {
          id: true,
          name: true,
          nozzleCode: true,
          cuve: { select: { id: true, name: true, item: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;

type Row = Prisma.TblPumpAttendantGetPayload<{ select: typeof pumpAttendantSelect }>;

/**
 * What the screens read: the rostered day's own facts flattened onto the row,
 * so a caller never has to know they live on the roster row — with the shift's
 * hours as "HH:mm" and the day as the calendar day it is stored as.
 */
function present(row: Row) {
  const { timeTable, ...rest } = row;
  return {
    ...rest,
    /** The rostered day this assignment is for. */
    dateOn: fromDate(timeTable.dateOn),
    siteId: timeTable.siteId,
    siteShiftId: timeTable.siteShiftId,
    userId: timeTable.userId,
    site: timeTable.site,
    user: timeTable.user,
    siteShift: { id: timeTable.shiftSite.id, shift: presentShift(timeTable.shiftSite.shift) },
    /** Written from the weekday plan, rather than arranged for this day alone. */
    fromPlan: row.fromPlanId !== null,
    /** The roster row itself: its role for the day, and whether they turned up. */
    roster: {
      id: timeTable.id, status: timeTable.status,
      isChief: timeTable.isChief, isSuport: timeTable.isSuport, extraShift: Boolean(timeTable.extraShift),
    },
  };
}

export class PumpAttendantRepository {
  constructor(private db: PrismaClient) {}

  /** Every filter reads through the roster row, which is where the facts are. */
  private where(query: PumpAttendantQuerySchema & { siteId?: string }): Prisma.TblPumpAttendantWhereInput {
    const days = query.startDate || query.endDate
      ? { dateOn: { gte: query.startDate && toDate(query.startDate), lte: query.endDate && toDate(query.endDate) } }
      : {};
    return {
      ...(query.pumpId && { pumpId: query.pumpId }),
      timeTable: {
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.siteShiftId && { siteShiftId: query.siteShiftId }),
        ...(query.userId && { userId: query.userId }),
        ...days,
      },
    };
  }

  async list(query: PumpAttendantQuerySchema & { siteId?: string }) {
    const rows = await this.db.tblPumpAttendant.findMany({
      where: this.where(query),
      orderBy: [
        { timeTable: { dateOn: "asc" } },
        { timeTable: { shiftSite: { shift: { startAt: "asc" } } } },
        { pump: { name: "asc" } },
        { timeTable: { user: { firstName: "asc" } } },
      ],
      select: pumpAttendantSelect,
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.tblPumpAttendant.findUnique({ where: { id }, select: pumpAttendantSelect });
    return row ? present(row) : null;
  }

  findSiteShift(id: string) {
    return this.db.tblShiftSite.findUnique({ where: { id }, include: { shift: true } });
  }

  findPump(id: string) {
    return this.db.tblPump.findUnique({
      where: { id },
      include: { nozzles: { select: { id: true, name: true, status: true } } },
    });
  }

  /** Staff assigned to the site, by `siteId` or an active site assignment. */
  findSiteUser(userId: string, siteId: string) {
    return this.db.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [{ siteId }, { sites: { some: { siteId, status: "active" } } }],
      },
      select: { id: true, firstName: true, lastName: true },
    });
  }

  /**
   * The roster rows putting this person on this shift on each of these days —
   * what a pump may be assigned against. The absent are left out: a pump
   * assignment for a day someone did not work says nothing.
   */
  rosterRows(userId: string, siteShiftId: string, dates: string[]) {
    return this.db.tblTimeTable.findMany({
      where: { userId, siteShiftId, dateOn: { in: dates.map(toDate) }, status: { not: ABSENT } },
      select: { id: true, dateOn: true },
    });
  }

  /** What this person already holds on those days, so a second pump is a deliberate choice. */
  held(userId: string, siteShiftId: string, dates: string[]) {
    return this.db.tblPumpAttendant.findMany({
      where: { timeTable: { userId, siteShiftId, dateOn: { in: dates.map(toDate) } } },
      select: { id: true, pumpId: true, pump: { select: { name: true } },
        timeTable: { select: { id: true, dateOn: true } } },
    });
  }

  /**
   * One row per rostered day, each with its own nozzles. Written in one
   * transaction: either the whole week lands or none of it does.
   */
  async createMany(input: CreatePumpAttendantSchema, rosterRows: Array<{ id: string; dateOn: Date }>) {
    const ids = await this.db.$transaction(async (tx) => {
      const written: string[] = [];
      for (const roster of rosterRows) {
        const row = await tx.tblPumpAttendant.create({
          data: {
            timeTableId: roster.id,
            pumpId: input.pumpId,
            pumpAttendantNozzles: { create: [...new Set(input.nozzleIds)].map((nozzleId) => ({ nozzleId })) },
          },
          select: { id: true },
        });
        written.push(row.id);
      }
      return written;
    });
    const rows = await this.db.tblPumpAttendant.findMany({
      where: { id: { in: ids } },
      orderBy: { timeTable: { dateOn: "asc" } },
      select: pumpAttendantSelect,
    });
    return rows.map(present);
  }

  /**
   * One day's assignment: its pump, and the nozzles of it. The nozzle list is
   * replaced wholesale — what is sent is what they handle.
   */
  async update(id: string, data: UpdatePumpAttendantSchema) {
    const row = await this.db.$transaction(async (tx) => {
      await tx.pumpAttendantNozzle.deleteMany({ where: { pumpAttendantId: id } });
      return tx.tblPumpAttendant.update({
        where: { id },
        data: {
          pumpId: data.pumpId,
          // Changed by hand, so the weekday plan no longer owns this day:
          // applying the plan again will leave it exactly as it is.
          fromPlanId: null,
          pumpAttendantNozzles: { create: [...new Set(data.nozzleIds)].map((nozzleId) => ({ nozzleId })) },
        },
        select: pumpAttendantSelect,
      });
    });
    return present(row);
  }

  /** The same person on the same pump that day already — the unique key, caught early. */
  findDuplicate(timeTableId: string, pumpId: string, excludeId?: string) {
    return this.db.tblPumpAttendant.findFirst({
      where: { timeTableId, pumpId, ...(excludeId && { id: { not: excludeId } }) },
      select: { id: true },
    });
  }

  delete(id: string) {
    return this.db.$transaction([
      this.db.pumpAttendantNozzle.deleteMany({ where: { pumpAttendantId: id } }),
      this.db.tblPumpAttendant.delete({ where: { id }, select: { id: true } }),
    ]);
  }

  /**
   * Copies a week's pump assignments onto the week after it: each one is
   * written against the roster row seven days later for the same person, pump
   * and shift. A day nobody is rostered on, or one that already has that pump,
   * is left alone — so copying twice changes nothing.
   */
  async copyWeek(startDate: string, siteId?: string) {
    const from = toDate(startDate);
    const until = toDate(fromDate(new Date(from.getTime() + 6 * 86_400_000)));
    const source = await this.db.tblPumpAttendant.findMany({
      where: { timeTable: { dateOn: { gte: from, lte: until }, ...(siteId ? { siteId } : {}) } },
      select: { pumpId: true,
        timeTable: { select: { userId: true, siteShiftId: true, dateOn: true } },
        pumpAttendantNozzles: { select: { nozzleId: true } } },
    });

    let copied = 0;
    let noRoster = 0;
    for (const row of source) {
      const next = toDate(fromDate(new Date(row.timeTable.dateOn.getTime() + 7 * 86_400_000)));
      const roster = await this.db.tblTimeTable.findFirst({
        where: { userId: row.timeTable.userId, siteShiftId: row.timeTable.siteShiftId,
          dateOn: next, status: { not: ABSENT } },
        select: { id: true },
      });
      if (!roster) {
        noRoster += 1;
        continue;
      }
      if (await this.findDuplicate(roster.id, row.pumpId)) continue;
      await this.db.tblPumpAttendant.create({
        data: { timeTableId: roster.id, pumpId: row.pumpId,
          pumpAttendantNozzles: { create: row.pumpAttendantNozzles.map(({ nozzleId }) => ({ nozzleId })) } },
      });
      copied += 1;
    }
    return { copied, noRoster, source: source.length };
  }
}
