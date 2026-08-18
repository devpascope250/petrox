import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateStockClearanceSchema } from "./clearance.schema.js";
export class StockClearanceRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.stockClearance.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        agentId: true,
        agent: true,
        status: true,
        amount: true,
        fees: true,
        clearedBy: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        createdAt: true,
      },
    });
  }

  async create(data: CreateStockClearanceSchema) {
    const checkForCentrolStock = await this.db.centralStock.findUnique({ where: { id: data.centralStockId }, select: {quantity: true} });
    if (!checkForCentrolStock) throw new NotFoundError("Central stock not found");
    if(data.status === "cleared" && !checkForCentrolStock) throw new NotFoundError("Central stock not found");
    if (data.status === "cleared") {
      const getAllClearanceQuantity = await this.db.stockClearance.aggregate({
        where: { centralStockId: data.centralStockId, status: "cleared" },
        _sum: { quantity: true }
      });
      if (Number(getAllClearanceQuantity._sum.quantity) + data.quantity > Number(checkForCentrolStock.quantity)) {
        throw new NotFoundError("Clearance quantity exceeds central stock quantity");
      }
    }
    return await this.db.stockClearance.create({
      data: {
        amount: data.amount,
        fees: data.fees,
        agentId: data.agentId,
        clearedBy: data.clearedBy,
        status: data.status,
        centralStockId: data.centralStockId,
        supportingDocUrl: data.supportingDocUrl,
        dmsDocUrl: data.dmsDocUrl,
        quantity: data.quantity,
      },
    });
  }

  find(id: string) {
    return this.db.stockClearance.findUnique({ where: { id } });
  }
}
