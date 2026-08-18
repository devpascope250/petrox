import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateCuveSchema } from "./cuve.schema.js";
export class CuveRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.tblCuve.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        item: true,
        minimum: true,
        maximum: true,
        deadStock: true,
        site: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateCuveSchema) {
    return this.db.tblCuve.create({
      data: {
        name: data.name,
        itemId: data.itemId,
        minimum: data.minimum,
        maximum: data.maximum,
        deadStock: data.deadStock,
        siteId: data.siteId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateCuveSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblCuve.update({
      where: { id: id },
      data: {
        name: data.name,
        itemId: data.itemId,
        minimum: data.minimum,
        maximum: data.maximum,
        deadStock: data.deadStock,
        siteId: data.siteId,
        status: "active",
      },
    });
  }


  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblCuve.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblCuve.findUnique({ where: { id } });
  }
}
