import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreatePumpSchema } from "./pump.schema.js";
export class PumpRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.tblPump.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        site: true
      },
    });
  }

  create(data: CreatePumpSchema) {
    return this.db.tblPump.create({
      data: {
        name: data.name,
        siteId: data.siteId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreatePumpSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblPump.update({
      where: { id: id },
      data: {
        name: data.name,
        siteId: data.siteId,
        status: "active",
      },
    });
  }


  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblPump.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblPump.findUnique({ where: { id } });
  }
}
