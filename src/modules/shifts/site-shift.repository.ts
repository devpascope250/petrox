import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateSiteShiftSchema } from "./site-shift.schema.js";
import { presentShift } from "./shift-scope.js";

const siteShiftSelect = {
  id: true,
  shiftId: true,
  siteId: true,
  turnonAt: true,
  status: true,
  // The hours come from the shift: they are the same at every site.
  shift: { select: { id: true, name: true, startAt: true, endAt: true, status: true } },
  site: { select: { id: true, name: true } },
  _count: { select: { tblPumpAttendants: true, tblTimeTables: true } },
} as const;

/** The shift's TIME columns go out as "HH:mm". */
function present<T extends { shift: { startAt: Date; endAt: Date } }>(row: T) {
  return { ...row, shift: presentShift(row.shift) };
}

export class SiteShiftRepository {
  constructor(private db: PrismaClient) {}

  async list(siteId?: string) {
    const rows = await this.db.tblShiftSite.findMany({
      where: siteId ? { siteId } : undefined,
      orderBy: [{ site: { name: "asc" } }, { shift: { startAt: "asc" } }],
      select: siteShiftSelect,
    });
    return rows.map(present);
  }

  async find(id: string) {
    const row = await this.db.tblShiftSite.findUnique({ where: { id }, select: siteShiftSelect });
    return row ? present(row) : null;
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
