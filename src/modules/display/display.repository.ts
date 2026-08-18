import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateDisplaySchema } from "./display.schema.js";
export class DisplayRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.tblDisplay.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        pump: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateDisplaySchema) {
    return this.db.tblDisplay.create({
      data: {
        name: data.name,
        code: data.code,
        pumpId: data.pumpId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateDisplaySchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblDisplay.update({
      where: { id: id },
      data: {
        name: data.name,
        code: data.code,
        pumpId: data.pumpId,
        status: "active",
      },
    });
  }


  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblDisplay.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblDisplay.findUnique({ where: { id } });
  }
}
