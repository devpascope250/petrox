import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { CreatePumpAttendantSchema, PumpAttendantQuerySchema } from "./pump-attendant.schema.js";
import { presentShift, shiftWithHours } from "./shift-scope.js";

const pumpAttendantSelect = {
  id: true,
  siteId: true,
  siteShiftId: true,
  pumpId: true,
  userId: true,
  createdAt: true,
  site: { select: { id: true, name: true } },
  pump: { select: { id: true, name: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
  siteShift: { select: { id: true, shift: shiftWithHours } },
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

/** The shift's hours go out as "HH:mm". */
function present(row: Row) {
  return { ...row, siteShift: { ...row.siteShift, shift: presentShift(row.siteShift.shift) } };
}

export class PumpAttendantRepository {
  constructor(private db: PrismaClient) {}

  async list(query: PumpAttendantQuerySchema & { siteId?: string }) {
    const rows = await this.db.tblPumpAttendant.findMany({
      where: {
        ...(query.siteId && { siteId: query.siteId }),
        ...(query.siteShiftId && { siteShiftId: query.siteShiftId }),
        ...(query.pumpId && { pumpId: query.pumpId }),
        ...(query.userId && { userId: query.userId }),
      },
      orderBy: [{ siteShift: { shift: { startAt: "asc" } } }, { pump: { name: "asc" } }, { user: { firstName: "asc" } }],
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

  /** The same attendant already on the same pump and shift. */
  findDuplicate(data: CreatePumpAttendantSchema, excludeId?: string) {
    return this.db.tblPumpAttendant.findFirst({
      where: {
        userId: data.userId,
        pumpId: data.pumpId,
        siteShiftId: data.siteShiftId,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
  }

  async create(data: CreatePumpAttendantSchema, siteId: string) {
    const row = await this.db.tblPumpAttendant.create({
      data: {
        siteShiftId: data.siteShiftId,
        pumpId: data.pumpId,
        userId: data.userId,
        siteId,
        pumpAttendantNozzles: { create: data.nozzleIds.map((nozzleId) => ({ nozzleId })) },
      },
      select: pumpAttendantSelect,
    });
    return present(row);
  }

  /** The nozzle list is replaced wholesale: what is sent is what he handles. */
  async update(id: string, data: CreatePumpAttendantSchema, siteId: string) {
    const row = await this.db.$transaction(async (tx) => {
      await tx.pumpAttendantNozzle.deleteMany({ where: { pumpAttendantId: id } });
      return tx.tblPumpAttendant.update({
        where: { id },
        data: {
          siteShiftId: data.siteShiftId,
          pumpId: data.pumpId,
          userId: data.userId,
          siteId,
          pumpAttendantNozzles: { create: data.nozzleIds.map((nozzleId) => ({ nozzleId })) },
        },
        select: pumpAttendantSelect,
      });
    });
    return present(row);
  }

  delete(id: string) {
    return this.db.$transaction([
      this.db.pumpAttendantNozzle.deleteMany({ where: { pumpAttendantId: id } }),
      this.db.tblPumpAttendant.delete({ where: { id }, select: { id: true } }),
    ]);
  }
}
