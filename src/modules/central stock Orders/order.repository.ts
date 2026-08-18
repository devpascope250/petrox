import type {
  PrismaClient,
  StockStateStatus,
} from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateCentralStockOrderSchema } from "./order.schema.js";
interface OrderTransaction {
  quantity: number;
  clearanceId: string;
  createdBy: string;
}
export class CentralStockOrderRepository {
  constructor(private db: PrismaClient) {}

  async list(startDate: string, endDate: string) {
    return await this.db.centralStockOrder.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      select: {
        id: true,
        quantity: true,
        status: true,
        site: true,
        clearance: true,
        approvedUser: true,
        totalPrice: true,
        unitPrice: true,
        createdAt: true
      }
    });
  }

  async create(
    data: Omit<CreateCentralStockOrderSchema, "itemId">[],
    transactionData: OrderTransaction[],
  ) {
    return await this.db.$transaction(async (tx) => {
      return await tx.centralStockOrder.createMany({
        data: data.map((item) => ({
          siteId: item.siteId,
          clearanceId: item.clearanceId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          createdBy: item.createdBy,
          approvedBy: item.approvedBy,
          status: item.status,
        })),
      });

      await tx.stockTransaction.createMany({
        data: transactionData.map((transaction) => ({
          quantity: transaction.quantity,
          type: "saleOut",
          createdBy: transaction.createdBy,
          stockClearanceId: transaction.clearanceId,
        })),
      });
    });
  }

  async getItemsByItemIdQTYStatus(
    itemId: string,
    clearanceStatus: StockStateStatus,
  ) {
    return await this.db.centralStock.findMany({
      where: {
        itemId: itemId,
        status: "inStock",
        ...[
          clearanceStatus === "cleared"
            ? { stockClearances: { some: { status: "cleared" } } }
            : {},
        ],
      },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        stockClearances: {
          select: {
            id: true,
            quantity: true,
            transactions: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }

  find(id: string) {
    return this.db.stockClearance.findUnique({ where: { id } });
  }

  async recordTransaction() {
    await this.db.stockTransaction.create({
      data: {
        quantity: 100,
        type: "saleOut",
        createdBy: "userId",
        stockClearanceId: "clearanceId",
      },
    });
  }
}
