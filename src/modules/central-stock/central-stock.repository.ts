import type { Prisma, PrismaClient, StockTransaction } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { releaseParkingForNomination } from "../vehicle-locations/vehicle-location.repository.js";
import {
  CentralStockReportQuerySchema,
  CreateCentralStockSchema,
  StockReconciliationsBodySchema,
  StockTransactionSchema,
} from "./central-stock.schema.js";

export class CentralStockRepository {
  constructor(private db: PrismaClient) {}

  async list(query: CentralStockReportQuerySchema) {
    const { startDate, endDate, itemId, status } = query;
    const depotId = query.depotId ?? query.deportId;
    const centralStocks = await this.db.centralStock.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        ...(startDate || endDate ? {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        } : {}),
        ...(depotId && { deportId: depotId }),
        ...(status && { status }),
        ...(itemId && { itemId }),
      },
      select: {
        id: true, 
        ambQuantity: true, 
        quantityAt20C: true, 
        supportingDocUrl: true,
        receiptNumber: true,
        status: true, 
        createdAt: true, 
        updatedAt: true,
        gainQty: true, 
        lossQty: true,
        toleranceRate: true,
        item: { select: {
          id: true, name: true, descriptions: true, status: true, toleranceRates: true,
          baseUnit: { select: { id: true, name: true, code: true } },
        } },
        deport: { select: { id: true, name: true, location: true, type: true, status: true } },
        t1Validation: { select: {
          id: true, exportingCountry: true, supportingDocUrl: true, createdAt: true,
          // What customs validated, so a receipt can be compared against it.
          quantityAt20C: true,
          nomination: { select: {
            id: true, ambQuantity: true, destination: true, expectedLoadingDate: true,
            nominationVessels: { orderBy: { createdAt: "asc" }, select: {
              id: true, stockId: true, ambQuantity: true,
              stock: { select: { item: true, cargo: true } },
            } },
          } },
        } },
        transactions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, quantity: true, type: true, note: true, supportingDocUrl: true,
            createdAt: true, updatedAt: true,
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        stockClearances: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, quantity: true, fees: true, amount: true, status: true,
            supportingDocUrl: true, dmsDocUrl: true, assessmentDocUrl: true, createdAt: true, updatedAt: true,
            agent: { select: { id: true, names: true, fees: true, status: true } },
            user: { select: { id: true, firstName: true, lastName: true } },
            centralStockOrders: { select: { quantity: true, orderType: true } },
          },
        },
      },
    });

    const report = new Map<string, {
      id: string;
      ambQuantity: Prisma.Decimal;
      quantityAt20C: Prisma.Decimal;
      supportingDocUrl: string | null;
      receiptNumber: string | null;
      status: string;
      gainQty: Prisma.Decimal | null;
      lossQty: Prisma.Decimal | null;
      toleranceRate: Prisma.Decimal | null;
      item: typeof centralStocks[number]["item"];
      summary: {
        totalQuantity: number;
        receivedQuantity: number;
        reconciledInQuantity: number;
        reconciledOutQuantity: number;
        soldOutQuantity: number;
        remainingQuantity: number;
        clearedQuantity: number;
        unclearedQuantity: number;
        stockCount: number;
        quantitiesByStatus: Record<string, number>;
        clearanceQuantitiesByStatus: Record<string, number>;
      };
      stocks: Array<{
        id: string; 
        quantityBeforeTransactions: number; 
        receivedQuantity: number;
        reconciledInQuantity: number;
        reconciledOutQuantity: number; soldOutQuantity: number; remainingQuantity: number;
        clearedQuantity: number; unclearedQuantity: number;
        supportingDocUrl: string | null;
        receiptNumber: string | null;
        // The receipt's own measured figures and reconciliation — previously
        // only the newest receipt's leaked onto the item group.
        ambQuantity: number; quantityAt20C: number;
        lossQty: number | null; gainQty: number | null; toleranceRate: number | null;
         status: typeof centralStocks[number]["status"];
        createdAt: Date; updatedAt: Date; depot: typeof centralStocks[number]["deport"];
        t1Validation: typeof centralStocks[number]["t1Validation"];
        clearances: Array<{
          id: string; quantity: number; fees: number | null;
          amount: number | null;
          status: typeof centralStocks[number]["stockClearances"][number]["status"];
          supportingDocUrl: string | null; dmsDocUrl: string | null; assessmentDocUrl: string | null;
          createdAt: Date; updatedAt: Date;
          agent: typeof centralStocks[number]["stockClearances"][number]["agent"];
          clearedBy: typeof centralStocks[number]["stockClearances"][number]["user"];
        }>;
        transactions: Array<{ id: string; quantity: number; type: StockTransaction["type"]; note: string | null;
          supportingDocUrl: string | null;
          createdAt: Date; updatedAt: Date; createdBy: typeof centralStocks[number]["transactions"][number]["user"] }>;
      }>;
    }>();

    for (const stock of centralStocks) {
      let itemReport = report.get(stock.item.id);
      if (!itemReport) {
        itemReport = {
          id: stock.id, 
          ambQuantity: stock.ambQuantity, 
          quantityAt20C: stock.quantityAt20C, 
          supportingDocUrl: stock.supportingDocUrl,
          receiptNumber: stock.receiptNumber,
          status: stock.status, 
        gainQty: stock.gainQty, 
        lossQty: stock.lossQty,
        toleranceRate: stock.toleranceRate,
          item: stock.item,
          summary: {
            totalQuantity: 0,
            receivedQuantity: 0,
            reconciledInQuantity: 0,
            reconciledOutQuantity: 0,
            soldOutQuantity: 0, remainingQuantity: 0, clearedQuantity: 0, unclearedQuantity: 0, stockCount: 0,
            quantitiesByStatus: {}, clearanceQuantitiesByStatus: {},
          },
          stocks: [],
        };
        report.set(stock.item.id, itemReport);
      }

      let receivedQuantity = 0;
      let reconciledInQuantity = 0;
      let reconciledOutQuantity = 0;
      let soldOutQuantity = 0;
      const transactions = stock.transactions.map((transaction) => {
          const quantity = Number(transaction.quantity);
          if (transaction.type === "received") receivedQuantity += quantity;
          if (transaction.type === "reconcilliationIn") reconciledInQuantity += quantity;
          if (transaction.type === "reconcilliationOut") reconciledOutQuantity += quantity;
          if (transaction.type === "saleOut") soldOutQuantity += quantity;
          return {
            id: transaction.id, quantity, type: transaction.type, note: transaction.note,
            supportingDocUrl: transaction.supportingDocUrl,
            createdAt: transaction.createdAt, updatedAt: transaction.updatedAt,
            createdBy: transaction.user,
          };
        });
      const clearances = stock.stockClearances.map((clearance) => {
        itemReport.summary.clearanceQuantitiesByStatus[clearance.status] =
          (itemReport.summary.clearanceQuantitiesByStatus[clearance.status] ?? 0) + Number(clearance.quantity);
        return {
          id: clearance.id, quantity: Number(clearance.quantity),
          fees: clearance.fees === null ? null : Number(clearance.fees),
          amount: clearance.amount === null ? null : Number(clearance.amount),
          status: clearance.status, supportingDocUrl: clearance.supportingDocUrl, dmsDocUrl: clearance.dmsDocUrl,
          assessmentDocUrl: clearance.assessmentDocUrl,
          createdAt: clearance.createdAt, updatedAt: clearance.updatedAt, agent: clearance.agent,
          clearedBy: clearance.user,
        };
      });

      const quantity = Number(stock.quantityAt20C);
      const remainingQuantity = (receivedQuantity + reconciledInQuantity) - (soldOutQuantity + reconciledOutQuantity);
      const availableCleared = Math.max(0, stock.stockClearances
        .filter((clearance) => clearance.status === "cleared")
        .reduce((balance, clearance) => balance + Number(clearance.quantity)
          - clearance.centralStockOrders.reduce((sold, order) => sold + Number(order.quantity), 0), 0));
      const clearedQuantity = Math.min(Math.max(0, remainingQuantity), availableCleared);
      const unclearedQuantity = Math.max(0, remainingQuantity - clearedQuantity);
      itemReport.summary.totalQuantity += quantity;
      itemReport.summary.receivedQuantity += receivedQuantity;
      itemReport.summary.reconciledInQuantity += reconciledInQuantity;
      itemReport.summary.reconciledOutQuantity += reconciledOutQuantity;
      itemReport.summary.soldOutQuantity += soldOutQuantity;
      itemReport.summary.remainingQuantity += remainingQuantity;
      itemReport.summary.clearedQuantity += clearedQuantity;
      itemReport.summary.unclearedQuantity += unclearedQuantity;
      itemReport.summary.stockCount += 1;
      itemReport.summary.quantitiesByStatus[stock.status] =
        (itemReport.summary.quantitiesByStatus[stock.status] ?? 0) + quantity;
      itemReport.stocks.push({
        id: stock.id, quantityBeforeTransactions: quantity, receivedQuantity, reconciledInQuantity,reconciledOutQuantity,
        soldOutQuantity, remainingQuantity, clearedQuantity, unclearedQuantity,
        supportingDocUrl: stock.supportingDocUrl, status: stock.status,
        receiptNumber: stock.receiptNumber,
        ambQuantity: Number(stock.ambQuantity), quantityAt20C: Number(stock.quantityAt20C),
        lossQty: stock.lossQty === null ? null : Number(stock.lossQty),
        gainQty: stock.gainQty === null ? null : Number(stock.gainQty),
        toleranceRate: stock.toleranceRate === null ? null : Number(stock.toleranceRate),
        createdAt: stock.createdAt, updatedAt: stock.updatedAt,
        // The database relation is named `deport`; expose it as `depot`.
        depot: stock.deport, t1Validation: stock.t1Validation, clearances, transactions,
      });
    }

    return Array.from(report.values());
  }

  async create(data: CreateCentralStockSchema) {
    const stock = await this.db.centralStock.findFirst({ where: { t1ValidationId: data.t1ValidationId } });
    if (stock) throw new BusinessError("400", "Can not Restock This T1 Validation");
    // const existed
    return await this.db.$transaction(async (tx) => {
      const nomination = await this.db.t1Validation.findFirst({ where: { id: data.t1ValidationId }, select: {nominationId: true} });
      const status = await tx.nominationTimeLineStatus.findFirst({where: {status: "stockReceived"}});
      if(status && nomination){
        await tx.nominationTimeLine.create({data: { nominationId: nomination.nominationId, timeLineStatusId: status.id, changedBy: data.createdBy }})
        // The trip is over, so the vehicle is no longer held in a parking. In
        // the same write as the stock and the stage: a vehicle left standing in
        // a parking it has already left would read as still being there.
        await releaseParkingForNomination(tx, nomination.nominationId);
      }

      return await tx.centralStock.create({
      data: {
        ambQuantity: data.ambQuantity, 
        quantityAt20C: data.quantityAt20C,
        deportId: data.deportId, 
        t1ValidationId: data.t1ValidationId, 
        receiptNumber: data.receiptNumber,
        itemId: data.itemId,
        transactions: { 
          create: { 
            quantity: data.quantityAt20C, 
            type: "received", 
            createdBy: data.createdBy 
          } },
        supportingDocUrl: data.supportingDocUrl,
        gainQty: data.gainQty,
        lossQty: data.lossQty,
        toleranceRate: data.toleranceRate
      },
    })});
  }

  async recentStock(centralStockId: string) {
    const transactions = await this.db.stockTransaction.findMany({ where: { centralStockId } });
    return calculatingRemainStock(transactions);
  }

  async createStockTransaction(data: StockTransactionSchema, userId: string) {
    const stock = await this.db.centralStock.findUnique({ where: { id: data.centralStockId } })
    if (!stock) {
      throw new NotFoundError("Central stock not found");
    }
    const currentStock = await this.recentStock(data.centralStockId);
    if (currentStock < data.quantity && data.type === "saleOut") {
      throw new BusinessError("400", `The Remaining Stock is ${currentStock} but you're Requesting ${data.quantity}`);
    }
    return await this.db.stockTransaction.create({
      data: {centralStockId: data.centralStockId, quantity: data.quantity, type: data.type, createdBy: userId },
    });
  }

  async createReconciliation(data: StockReconciliationsBodySchema) {
  return await this.db.$transaction(async(tx) => {
    const stock = await tx.centralStock.findUnique({
      where: { id: data.centralStockId },
      select: { quantityAt20C: true, transactions: { select: { quantity: true, type: true } },
        stockClearances: { select: { quantity: true } } },
    });
    if (!stock) throw new NotFoundError("Central stock not found");
    if (data.reconciliationType === "reconcilliationOut") {
      const remaining = calculatingRemainStock(stock.transactions);
      if (data.quantity > remaining) {
        throw new BusinessError("400", `The Remaining Stock is ${remaining} but you're Reconciling ${data.quantity}`);
      }
      const allocated = stock.stockClearances.reduce((sum, row) => sum + Number(row.quantity), 0);
      if (Number(stock.quantityAt20C) - data.quantity < allocated) {
        throw new BusinessError("400", "Reconciliation would reduce stock below cleared or sold allocations");
      }
    }
    if (data.state === "cleared") {
      if (!(await tx.stockClearance.findFirst({where: {centralStockId: data.centralStockId}}))) throw new BusinessError("400", "Can not Reconciliate stock without cleared before!");
      await tx.stockClearance.create({data: {centralStockId: data.centralStockId, quantity: data.quantity, clearedBy: data.createdBy, status: "cleared"}})
    }
    await tx.centralStock.update(
      {
        where: {
          id: data.centralStockId,
        },
        data: {
          quantityAt20C: {
          ...(data.reconciliationType === "reconcilliationIn" ? {
            increment: data.quantity
          }: {decrement: data.quantity})}
        }
      }
    );

    return await tx.stockTransaction.create({ data: {
      centralStockId: data.centralStockId, 
      quantity: data.quantity,
      type: data.reconciliationType, 
      createdBy: data.createdBy,
      note: data.note, 
      supportingDocUrl: data.supportingDocUrl
    }})
  })
}
}



export function calculatingRemainStock(
  transactions: Array<{
    quantity: number | { toString(): string };
    type: StockTransaction["type"];
  }>,
) {
  return transactions.reduce((stock, transaction) => {
    switch (transaction.type) {
      case "received":
      case "reconcilliationIn":
        return stock + Number(transaction.quantity);
      case "saleOut":
      case "reconcilliationOut":
        return stock - Number(transaction.quantity);
      default:
        return stock;
    }
  }, 0);
}
