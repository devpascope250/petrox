import type { PrismaClient, StatusType } from "../../../prisma/generated/prisma/client.js";
import type {
  CreateItemToleranceRateInput,
  UpdateItemToleranceRateInput,
} from "./item-tolerance-rate.schema.js";

const itemToleranceRateInclude = { item: true } as const;

export class ItemToleranceRateRepository {
  constructor(private db: PrismaClient) {}

  list() {
    return this.db.itemToleranceRate.findMany({
      orderBy: { createdAt: "desc" },
      include: itemToleranceRateInclude,
    });
  }

  find(id: string) {
    return this.db.itemToleranceRate.findUnique({
      where: { id },
      include: itemToleranceRateInclude,
    });
  }

  create(data: CreateItemToleranceRateInput) {
    return this.db.itemToleranceRate.create({
      data,
      include: itemToleranceRateInclude,
    });
  }

  update(id: string, data: UpdateItemToleranceRateInput) {
    return this.db.itemToleranceRate.update({
      where: { id },
      data,
      include: itemToleranceRateInclude,
    });
  }

  changeStatus(id: string, status: StatusType) {
    return this.db.itemToleranceRate.update({
      where: { id },
      data: { status },
      include: itemToleranceRateInclude,
    });
  }


  findItem(id: string) {
    return this.db.item.findUnique({ where: { id }, select: { id: true } });
  }

  getItemToleranceRateByItemId(itemId: string) {
    return this.db.itemToleranceRate.findFirst({
      where: { itemId, status: "active" }
    });
  }
}
