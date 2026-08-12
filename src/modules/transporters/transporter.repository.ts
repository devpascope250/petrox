import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateTransporterSchema } from "./transporter.schema.js";
export class TransporterRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.transporter.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        status: true,
        tinNumber: true,
        createdAt: true
      },
    });
  }

  create(data: CreateTransporterSchema) {
    return this.db.transporter.create({
      data: {
        ...data
      },
    });
  }

  async update(id: string, data: CreateTransporterSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.transporter.update({
      where: { id: id },
      data: {
        ...data
      },
    });
  }

  async changeStatus(id: string) {
    const transporter = await this.find(id);
    if (!transporter) throw new NotFoundError();
    return await this.db.transporter.update({
      where: { id },
      data: { status: transporter.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.transporter.findUnique({ where: { id } });
  }
}
