import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateShiftSchema } from "./shift.schema.js";
import { presentShift, shiftWithHours, toTime } from "./shift-scope.js";

export class ShiftRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    const rows = await this.db.tblShift.findMany({
      // In the order the day runs.
      orderBy: [{ startAt: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        startAt: true,
        endAt: true,
        status: true,
        createdAt: true,
        _count: { select: { tblShiftSites: true } },
      },
    });
    return rows.map(presentShift);
  }

  async find(id: string) {
    const row = await this.db.tblShift.findUnique({ where: { id } });
    return row ? presentShift(row) : null;
  }

  findByName(name: string, excludeId?: string) {
    return this.db.tblShift.findFirst({
      where: { name, ...(excludeId && { id: { not: excludeId } }) },
    });
  }

  async create(data: CreateShiftSchema) {
    const row = await this.db.tblShift.create({
      // Active from the start — the column defaults to false, which would hide
      // a new shift from every picker until someone switched it on.
      data: { name: data.name, startAt: toTime(data.startAt), endAt: toTime(data.endAt), status: true },
    });
    return presentShift(row);
  }

  async update(id: string, data: CreateShiftSchema) {
    if (!(await this.find(id))) throw new NotFoundError("Shift");
    const row = await this.db.tblShift.update({
      where: { id },
      data: { name: data.name, startAt: toTime(data.startAt), endAt: toTime(data.endAt) },
    });
    return presentShift(row);
  }

  async changeStatus(id: string) {
    const shift = await this.find(id);
    if (!shift) throw new NotFoundError("Shift");
    const row = await this.db.tblShift.update({
      where: { id },
      data: { status: !shift.status },
    });
    return presentShift(row);
  }

  /**
   * Everything the shift forms pick from. `siteId` narrows the site-level
   * lists; the sites themselves are narrowed by `sitesWhere`.
   */
  async formOptions(siteId: string | undefined, sitesWhere: { id?: string }) {
    const [sites, shifts, siteShifts, pumps, users] = await Promise.all([
      this.db.tblSite.findMany({
        where: { status: "active", ...sitesWhere },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.db.tblShift.findMany({
        where: { status: true },
        orderBy: [{ startAt: "asc" }, { name: "asc" }],
        ...shiftWithHours,
      }),
      siteId
        ? this.db.tblShiftSite.findMany({
            where: { siteId, status: 1 },
            orderBy: { shift: { startAt: "asc" } },
            select: { id: true, shift: shiftWithHours },
          })
        : [],
      siteId
        ? this.db.tblPump.findMany({
            where: { siteId, status: "active" },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              nozzles: {
                where: { status: "active" },
                orderBy: { name: "asc" },
                select: {
                  id: true,
                  name: true,
                  nozzleCode: true,
                  cuve: { select: { id: true, name: true, item: { select: { id: true, name: true } } } },
                },
              },
            },
          })
        : [],
      // Staff working at the site: attendants and chiefs are picked from these.
      siteId
        ? this.db.user.findMany({
            where: {
              isActive: true,
              clientId: null,
              OR: [{ siteId }, { sites: { some: { siteId, status: "active" } } }],
            },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            select: { id: true, firstName: true, lastName: true, position: true },
          })
        : [],
    ]);
    return {
      sites,
      shifts: shifts.map(presentShift),
      siteShifts: siteShifts.map((row) => ({ ...row, shift: presentShift(row.shift) })),
      pumps,
      users,
    };
  }
}
