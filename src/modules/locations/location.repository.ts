import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import type { CreateBuikLocationSchema, CreateLocationSchema } from "./location.schema.js";

const locationSelect = {
  id: true,
  name: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class LocationRepository {
  constructor(private db: PrismaClient) {}

  list() {
    return this.db.location.findMany({
      where: { parentId: null },
      orderBy: { name: "asc" },
      select: locationSelect,
    });
  }

  find(id: string) {
    return this.db.location.findUnique({
      where: { id },
      select: {
        ...locationSelect,
        parent: { select: locationSelect },
        children: {
          orderBy: { name: "asc" },
          select: locationSelect,
        },
      },
    });
  }

  findByParent(parentId: string) {
    return this.db.location.findMany({
      where: { parentId },
      orderBy: { name: "asc" },
      select: locationSelect,
    });
  }

  async create(data: CreateLocationSchema) {
    if (data.parentId && !(await this.db.location.findUnique({ where: { id: data.parentId } }))) {
      throw new NotFoundError("Parent location");
    }

    return this.db.location.create({
      data,
      select: locationSelect,
    });
  }

    async createBuilk(data: CreateBuikLocationSchema) {
    return this.db.location.createMany({
      data
    });
  }
}
