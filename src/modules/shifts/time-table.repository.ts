import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { applyPlans } from "./pump-plan-apply.js";
import { CreateTimeTableSchema, TimeTableQuerySchema } from "./time-table.schema.js";
import { dayOfWeek, fromDate, presentShift, shiftWithHours, toDate } from "./shift-scope.js";

const person = { select: { id: true, firstName: true, lastName: true } } as const;

const timeTableSelect = {
  id: true,
  dateOn: true,
  days: true,
  status: true,
  extraShift: true,
  isChief: true,
  isSuport: true,
  siteId: true,
  siteShiftId: true,
  userId: true,
  createdAt: true,
  site: { select: { id: true, name: true } },
  user: person,
  shiftSite: { select: { id: true, shift: shiftWithHours } },
} as const;

type Row = Prisma.TblTimeTableGetPayload<{ select: typeof timeTableSelect }>;
type Tx = Prisma.TransactionClient;
type Person = { id: string; firstName: string; lastName: string };

/** Who lost a role because it was given to someone else. */
export type ReplacedRoles = { chief: Person | null; supporter: Person | null };

/** The date goes out as "YYYY-MM-DD" and the shift's hours as "HH:mm". */
function present(row: Row) {
  return {
    ...row,
    dateOn: fromDate(row.dateOn),
    extraShift: row.extraShift === 1,
    shiftSite: { ...row.shiftSite, shift: presentShift(row.shiftSite.shift) },
  };
}

export class TimeTableRepository {
  constructor(private db: PrismaClient) {}

  async list(query: TimeTableQuerySchema & { siteId?: string }) {
    const rows = await this.db.tblTimeTable.findMany({
      where: {
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.siteShiftId && { siteShiftId: query.siteShiftId }),
        ...((query.startDate || query.endDate) && {
          dateOn: {
            ...(query.startDate && { gte: toDate(query.startDate) }),
            ...(query.endDate && { lte: toDate(query.endDate) }),
          },
        }),
      },
      // The chief first, then the supporter, then everyone else by name.
      orderBy: [
        { dateOn: "asc" },
        { shiftSite: { shift: { startAt: "asc" } } },
        { isChief: "desc" },
        { isSuport: "desc" },
        { user: { firstName: "asc" } },
      ],
      select: timeTableSelect,
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.tblTimeTable.findUnique({ where: { id }, select: timeTableSelect });
    return row ? present(row) : null;
  }

  findSiteShift(id: string) {
    return this.db.tblShiftSite.findUnique({ where: { id }, include: { shift: true } });
  }

  /** Staff assigned to the site, by `siteId` or an active site assignment. */
  findSiteUser(userId: string, siteId: string) {
    return this.db.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [{ siteId }, { sites: { some: { siteId, status: "active" } } }],
      },
      select: { id: true },
    });
  }

  /** The same person already rostered on the same shift that day. */
  findDuplicate(data: CreateTimeTableSchema, excludeId?: string) {
    return this.db.tblTimeTable.findFirst({
      where: {
        userId: data.userId,
        siteShiftId: data.siteShiftId,
        dateOn: toDate(data.dateOn),
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  }

  /**
   * A shift has one chief and one supporter per date. Before a role is given
   * to `keepId`, it is taken from whoever else holds it on that shift and date.
   * Returns who lost it, so the caller can tell the user.
   */
  private async takeRolesFromOthers(
    tx: Tx,
    slot: { siteShiftId: string; dateOn: Date },
    roles: { isChief: boolean; isSuport: boolean },
    keepId?: string,
  ): Promise<ReplacedRoles> {
    const replaced: ReplacedRoles = { chief: null, supporter: null };
    // Only the shift and the date define the slot — nothing else narrows it.
    const others = {
      siteShiftId: slot.siteShiftId,
      dateOn: slot.dateOn,
      ...(keepId && { id: { not: keepId } }),
    };
    if (roles.isChief) {
      const holder = await tx.tblTimeTable.findFirst({ where: { ...others, isChief: true }, select: { user: person } });
      replaced.chief = holder?.user ?? null;
      await tx.tblTimeTable.updateMany({ where: { ...others, isChief: true }, data: { isChief: false } });
    }
    if (roles.isSuport) {
      const holder = await tx.tblTimeTable.findFirst({ where: { ...others, isSuport: true }, select: { user: person } });
      replaced.supporter = holder?.user ?? null;
      await tx.tblTimeTable.updateMany({ where: { ...others, isSuport: true }, data: { isSuport: false } });
    }
    return replaced;
  }

  private fields(data: CreateTimeTableSchema, siteId: string) {
    const dateOn = toDate(data.dateOn);
    return {
      siteShiftId: data.siteShiftId,
      userId: data.userId,
      siteId,
      dateOn,
      days: dayOfWeek(dateOn),
      extraShift: data.extraShift ? 1 : 0,
      isChief: data.isChief,
      isSuport: data.isSuport,
    };
  }

  create(data: CreateTimeTableSchema, siteId: string) {
    const fields = this.fields(data, siteId);
    return this.db.$transaction(async (tx) => {
      const replaced = await this.takeRolesFromOthers(tx, fields, fields);
      const row = await tx.tblTimeTable.create({ data: { ...fields, status: 0 }, select: timeTableSelect });
      // The standing arrangement for that weekday, put into effect: rostering
      // someone is all it takes to put them on their pump.
      const fromPlan = await applyPlans(tx, [{ id: row.id, userId: fields.userId,
        siteShiftId: fields.siteShiftId, days: fields.days }]);
      return { ...present(row), replaced, fromPlan };
    });
  }

  update(id: string, data: CreateTimeTableSchema, siteId: string) {
    const fields = this.fields(data, siteId);
    return this.db.$transaction(async (tx) => {
      const replaced = await this.takeRolesFromOthers(tx, fields, fields, id);
      const row = await tx.tblTimeTable.update({ where: { id }, data: fields, select: timeTableSelect });
      return { ...present(row), replaced };
    });
  }

  /** Gives this entry the chief or supporter role, or takes its role away. */
  setRole(id: string, role: "chief" | "supporter" | "none") {
    const roles = { isChief: role === "chief", isSuport: role === "supporter" };
    return this.db.$transaction(async (tx) => {
      const entry = await tx.tblTimeTable.findUniqueOrThrow({
        where: { id },
        select: { siteShiftId: true, dateOn: true },
      });
      const replaced = await this.takeRolesFromOthers(tx, entry, roles, id);
      const row = await tx.tblTimeTable.update({ where: { id }, data: roles, select: timeTableSelect });
      return { ...present(row), replaced };
    });
  }

  /**
   * Copies a week of the roster onto the following week: each entry lands on
   * the same weekday, 7 days later, as planned.
   *
   * Nothing already in the target week is overwritten. A person already
   * rostered on that shift and date is skipped, and a copied chief or supporter
   * comes across without the role if the target slot already has one. Entries
   * on a switched-off shift, or for someone no longer active at the site, are
   * skipped too. The counts returned say exactly what happened.
   */
  copyWeek(startDate: string, siteId?: string) {
    const DAY = 24 * 60 * 60 * 1000;
    const from = toDate(startDate);
    const to = new Date(from.getTime() + 6 * DAY);
    const targetFrom = new Date(from.getTime() + 7 * DAY);
    const targetTo = new Date(from.getTime() + 13 * DAY);
    const scope = siteId ? { siteId } : {};

    return this.db.$transaction(async (tx) => {
      const [source, existing] = await Promise.all([
        tx.tblTimeTable.findMany({
          where: { ...scope, dateOn: { gte: from, lte: to } },
          // Chiefs and supporters first, so they claim the role before anyone else.
          orderBy: [{ dateOn: "asc" }, { isChief: "desc" }, { isSuport: "desc" }, { createdAt: "asc" }],
          select: {
            siteShiftId: true, userId: true, siteId: true, dateOn: true,
            extraShift: true, isChief: true, isSuport: true,
            shiftSite: { select: { status: true } },
            user: { select: { isActive: true, siteId: true, sites: { where: { status: "active" }, select: { siteId: true } } } },
          },
        }),
        tx.tblTimeTable.findMany({
          where: { ...scope, dateOn: { gte: targetFrom, lte: targetTo } },
          select: { siteShiftId: true, userId: true, dateOn: true, isChief: true, isSuport: true },
        }),
      ]);

      const slot = (siteShiftId: string, dateOn: Date) => `${siteShiftId}|${fromDate(dateOn)}`;
      const rostered = new Set(existing.map((row) => `${slot(row.siteShiftId, row.dateOn)}|${row.userId}`));
      const hasChief = new Set(existing.filter((row) => row.isChief).map((row) => slot(row.siteShiftId, row.dateOn)));
      const hasSupporter = new Set(existing.filter((row) => row.isSuport).map((row) => slot(row.siteShiftId, row.dateOn)));

      const skipped = { alreadyRostered: 0, shiftSwitchedOff: 0, personUnavailable: 0 };
      let rolesNotCopied = 0;
      const rows: Prisma.TblTimeTableCreateManyInput[] = [];

      for (const entry of source) {
        const dateOn = new Date(entry.dateOn.getTime() + 7 * DAY);
        const key = slot(entry.siteShiftId, dateOn);
        if (rostered.has(`${key}|${entry.userId}`)) { skipped.alreadyRostered += 1; continue; }
        if (entry.shiftSite.status !== 1) { skipped.shiftSwitchedOff += 1; continue; }
        const atSite = entry.user.siteId === entry.siteId || entry.user.sites.some((site) => site.siteId === entry.siteId);
        if (!entry.user.isActive || !atSite) { skipped.personUnavailable += 1; continue; }

        // The target week's own chief and supporter are kept.
        const isChief = entry.isChief && !hasChief.has(key);
        const isSuport = entry.isSuport && !hasSupporter.has(key);
        if ((entry.isChief && !isChief) || (entry.isSuport && !isSuport)) rolesNotCopied += 1;
        if (isChief) hasChief.add(key);
        if (isSuport) hasSupporter.add(key);
        rostered.add(`${key}|${entry.userId}`);

        rows.push({
          siteShiftId: entry.siteShiftId, userId: entry.userId, siteId: entry.siteId,
          dateOn, days: dayOfWeek(dateOn), extraShift: entry.extraShift,
          isChief, isSuport, status: 0,
        });
      }

      if (rows.length) await tx.tblTimeTable.createMany({ data: rows });
      // Every day just rostered gets whatever its weekday's plan says, so a
      // copied week arrives with its pumps already on it.
      const written = await tx.tblTimeTable.findMany({
        where: { dateOn: { gte: targetFrom, lte: targetTo }, ...(siteId ? { siteId } : {}) },
        select: { id: true, userId: true, siteShiftId: true, days: true },
      });
      const fromPlan = await applyPlans(tx, written);
      return {
        from: { startDate: fromDate(from), endDate: fromDate(to) },
        to: { startDate: fromDate(targetFrom), endDate: fromDate(targetTo) },
        found: source.length,
        copied: rows.length,
        skipped,
        rolesNotCopied,
        /** Pump assignments written from the weekday plans. */
        fromPlan,
      };
    });
  }

  async changeStatus(id: string, status: number) {
    const row = await this.db.tblTimeTable.update({
      where: { id },
      data: { status },
      select: timeTableSelect,
    });
    return present(row);
  }

  delete(id: string) {
    return this.db.tblTimeTable.delete({ where: { id }, select: { id: true } });
  }
}
