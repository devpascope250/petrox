import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateStockClearanceSchema } from "./clearance.schema.js";
export class StockClearanceRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.stockClearance.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quantity: true,
        centralStock: { 
          select: { 
            id: true, 
            itemId: true, 
            ambQuantity: true, 
            quantityAt20C: true,
            gainQty: true,
            lossQty: true,
            toleranceRate: true,
            createdAt: true 
          }, 
        },
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
    return this.db.$transaction(async (tx) => {
      if (data.agentId) {
        const agent = await tx.clearingAgent.findUnique({ where: { id: data.agentId } });
        if (!agent) throw new NotFoundError("Clearing agent not found");
        if (agent.status !== "active") throw new BusinessError("400", "Clearing agent is inactive");
      }
      const stockSelect = {
        id: true, itemId: true, status: true,  ambQuantity: true, quantityAt20C: true,
        transactions: { select: { quantity: true, type: true } },
        stockClearances: { select: { quantity: true, status: true,
          centralStockOrders: { select: { quantity: true } } } },
      } as const;

      let stocks;
      if (data.type === "manual") {
        const stock = await tx.centralStock.findUnique({
          where: { id: data.centralStockId! },
          select: stockSelect,
        });
        if (!stock) throw new NotFoundError("Central stock not found");
        if (stock.itemId !== data.itemId) {
          throw new BusinessError("400", "Central stock does not belong to the selected item");
        }
        if (stock.status !== "inStock") {
          throw new BusinessError("400", "Central stock is not in stock");
        }
        stocks = [stock];
      } else {
        stocks = await tx.centralStock.findMany({
          where: { itemId: data.itemId, status: "inStock" },
          orderBy: { createdAt: "asc" },
          select: stockSelect,
        });
      }

      let requested = data.quantity;
      const allocations: Array<{ centralStockId: string; quantity: number }> = [];
      for (const stock of stocks) {
        if (requested <= 0) break;
        const allocated = stock.stockClearances.reduce((sum, row) => sum + Number(row.quantity), 0);
        const physicalRemaining = stock.transactions.reduce((balance, transaction) => {
          const quantity = Number(transaction.quantity);
          return transaction.type === "received" || transaction.type === "reconcilliationIn"
            ? balance + quantity : balance - quantity;
        }, 0);
        const clearedRemaining = stock.stockClearances
          .filter((row) => row.status === "cleared")
          .reduce((balance, row) => balance + Number(row.quantity)
            - row.centralStockOrders.reduce((sold, order) => sold + Number(order.quantity), 0), 0);
        const legalUncleared = Number(stock.quantityAt20C) - allocated;
        const physicalUncleared = physicalRemaining - Math.max(0, clearedRemaining);
        const available = Math.max(0, Math.min(legalUncleared, physicalUncleared));
        const quantity = Math.min(available, requested);
        if (quantity > 0) allocations.push({ centralStockId: stock.id, quantity });
        requested -= quantity;
      }
      if (requested > 0) {
        throw new BusinessError("400", `Only ${data.quantity - requested} uncleared stock is available`);
      }

      const rows = [];
      for (const allocation of allocations) {
        const ratio = allocation.quantity / data.quantity;
        rows.push(await tx.stockClearance.create({ data: {
          ...allocation, status: "cleared",
          fees: data.fees === undefined ? undefined : data.fees * ratio,
          amount: data.amount === undefined ? undefined : data.amount * ratio,
          agentId: data.agentId, clearedBy: data.clearedBy,
          dmsDocUrl: data.dmsDocUrl,
          assessmentDocUrl: data.assessmentDocUrl,
        }}));
      }
      return rows;
    }, { isolationLevel: "Serializable" });
  }

  find(id: string) {
    return this.db.stockClearance.findUnique({ where: { id } });
  }
}
