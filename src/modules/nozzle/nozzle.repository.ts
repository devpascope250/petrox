import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { CreateNozzleSchema, NozzleListQuery } from "./nozzle.schema.js";

const nozzleSelect = {
  id: true,
  name: true,
  nozzleCode: true,
  pump: true,
  display: true,
  cuve: true,
  status: true,
  createdAt: true,
} as const;

export class NozzleRepository {
  constructor(private db: PrismaClient) {}

  /** One page of nozzles, filtered by site (through the pump), pump and search. */
  async listPage(query: NozzleListQuery) {
    const where: Prisma.TblNozzleWhereInput = {
      ...(query.pumpId ? { pumpId: query.pumpId } : {}),
      ...(query.siteId ? { pump: { siteId: query.siteId } } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { nozzleCode: { contains: query.search } }] }
        : {}),
    };
    return this.db.$transaction([
      this.db.tblNozzle.findMany({
        ...paginationArgs(query),
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: nozzleSelect,
      }),
      this.db.tblNozzle.count({ where }),
    ]);
  }

  async list() {
    return await this.db.tblNozzle.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        nozzleCode: true,
        pump: true,
        display: true,
        cuve: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateNozzleSchema) {
    return this.db.tblNozzle.create({
      data: {
        name: data.name,
        nozzleCode: data.nozzleCode,
        pumpId: data.pumpId,
        status: "active",
        displayId: data.displayId,
        cuveId: data.cuveId,
      },
    });
  }

  async update(id: string, data: CreateNozzleSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblNozzle.update({
      where: { id: id },
      data: {
        name: data.name,
        nozzleCode: data.nozzleCode,
        pumpId: data.pumpId,
        displayId: data.displayId,
        cuveId: data.cuveId,
        status: "active",
      },
    });
  }


  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblNozzle.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblNozzle.findUnique({ where: { id } });
  }

  /** The nozzle a scanned code is bound to, with where it stands; `null` when the code is free. */
  findByCode(nozzleCode: string) {
    return this.db.tblNozzle.findUnique({
      where: { nozzleCode },
      select: { id: true, name: true, nozzleCode: true, status: true,
        pump: { select: { id: true, name: true, site: { select: { id: true, name: true } } } } },
    });
  }

  /**
   * Binds a nozzle record to the physical nozzle by the code scanned off it.
   * The code identifies one physical nozzle, so another nozzle holding it is
   * refused by name; binding the code the nozzle already has changes nothing.
   */
  async bindCode(id: string, nozzleCode: string) {
    const nozzle = await this.find(id);
    if (!nozzle) throw new NotFoundError("Nozzle");
    if (nozzle.nozzleCode === nozzleCode) return this.db.tblNozzle.findUniqueOrThrow({ where: { id }, select: nozzleSelect });
    const holder = await this.findByCode(nozzleCode);
    if (holder) throw this.codeTaken(nozzleCode, holder);
    try {
      return await this.db.tblNozzle.update({ where: { id }, data: { nozzleCode }, select: nozzleSelect });
    } catch (error) {
      // Two scans of the same code racing: the unique index stops the second.
      if ((error as { code?: string }).code === "P2002") {
        const winner = await this.findByCode(nozzleCode);
        if (winner) throw this.codeTaken(nozzleCode, winner);
      }
      throw error;
    }
  }

  private codeTaken(nozzleCode: string, holder: NonNullable<Awaited<ReturnType<NozzleRepository["findByCode"]>>>) {
    return new ConflictError(
      "NOZZLE_CODE_TAKEN",
      `Code ${nozzleCode} is already bound to ${holder.name} on ${holder.pump.name} at ${holder.pump.site.name}`,
      { nozzleCode, nozzle: holder },
    );
  }
}
