import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateDeportSchema } from "./deport.schema.js";

export class DeportRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.deport.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        location: true,
        name: true,
        type: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateDeportSchema) {
    return this.db.deport.create({
      data: {
        name: data.name,
        location: data.location,
        type: data.type,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateDeportSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.deport.update({
      where: { id: id },
      data: data,
    });
  }

  async changeStatus(id: string) {
    const deport = await this.find(id);
    if (!deport) throw new NotFoundError();
   return await this.db.deport.update({
      where: { id },
      data: { status: deport.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.deport.findUnique({ where: { id } });
  }
}
