import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateSiteShiftSchema } from "./site-shift.schema.js";
import { presentShift, toDate } from "./shift-scope.js";

const siteShiftSelect = {
  id: true,
  shiftId: true,
  siteId: true,
  turnonAt: true,
  status: true,
  // The hours come from the shift: they are the same at every site.
  shift: { select: { id: true, name: true, startAt: true, endAt: true, status: true } },
  site: { select: { id: true, name: true } },
  // Pump assignments are **not** counted here: the rota hangs off the roster
  // row now, so a site shift has no assignments of its own to count. They are
  // counted through the time table, below.
  _count: { select: { tblTimeTables: true } },
} as const;

/** The shift's TIME columns go out as "HH:mm". */
function present<T extends { shift: { startAt: Date; endAt: Date } }>(row: T, upcomingAssignments = 0) {
  return { ...row, shift: presentShift(row.shift), upcomingAssignments };
}

/** Today, by the server's clock, as the DATE the roster stores. */
function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return toDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

export class SiteShiftRepository {
  constructor(private db: PrismaClient) {}

  /**
   * How many pump assignments each of these shifts has **from today onward**.
   *
   * A dated rota keeps every week it has ever had, so counting all of them
   * would only grow and say nothing. What a shift's row is really answering is
   * "is anyone on a pump here going forward" — zero is the warning.
   *
   * One small count each: a site runs a handful of shifts, and the rota's own
   * index is on the roster row.
   */
  private async upcoming(ids: string[]) {
    const from = today();
    const counts = await Promise.all(ids.map((id) =>
      this.db.tblPumpAttendant.count({ where: { timeTable: { siteShiftId: id, dateOn: { gte: from } } } })));
    return new Map(ids.map((id, index) => [id, counts[index]]));
  }

  async list(siteId?: string) {
    const rows = await this.db.tblShiftSite.findMany({
      where: siteId ? { siteId } : undefined,
      orderBy: [{ site: { name: "asc" } }, { shift: { startAt: "asc" } }],
      select: siteShiftSelect,
    });
    const assignments = await this.upcoming(rows.map((row) => row.id));
    return rows.map((row) => present(row, assignments.get(row.id) ?? 0));
  }

  async find(id: string) {
    const row = await this.db.tblShiftSite.findUnique({ where: { id }, select: siteShiftSelect });
    if (!row) return null;
    return present(row, (await this.upcoming([id])).get(id) ?? 0);
  }

  /** The same shift already set up at the same site. */
  findDuplicate(shiftId: string, siteId: string, excludeId?: string) {
    return this.db.tblShiftSite.findFirst({
      where: { shiftId, siteId, ...(excludeId && { id: { not: excludeId } }) },
    });
  }

  findShift(id: string) {
    return this.db.tblShift.findUnique({ where: { id } });
  }

  findSite(id: string) {
    return this.db.tblSite.findUnique({ where: { id } });
  }

  async create(data: CreateSiteShiftSchema) {
    const row = await this.db.tblShiftSite.create({
      data: {
        shiftId: data.shiftId,
        siteId: data.siteId,
        status: 1,
      },
      select: siteShiftSelect,
    });
    return present(row);
  }

  async update(id: string, data: CreateSiteShiftSchema) {
    const row = await this.db.tblShiftSite.update({
      where: { id },
      data: {
        shiftId: data.shiftId,
        siteId: data.siteId,
      },
      select: siteShiftSelect,
    });
    return present(row);
  }

  /** 1 = on, 0 = off. Switching it on records when, in `turnonAt`. */
  async changeStatus(id: string) {
    const current = await this.db.tblShiftSite.findUnique({ where: { id } });
    if (!current) throw new NotFoundError("Site shift");
    const turningOn = current.status !== 1;
    const row = await this.db.tblShiftSite.update({
      where: { id },
      data: { status: turningOn ? 1 : 0, ...(turningOn && { turnonAt: new Date() }) },
      select: siteShiftSelect,
    });
    return present(row);
  }
}
