import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateNozzleSchema } from "./nozzle.schema.js";
export class NozzleRepository {
  constructor(private db: PrismaClient) {}

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
}
