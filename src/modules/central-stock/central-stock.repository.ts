import { StockTransaction } from "../../../prisma/generated/prisma/browser.js";
import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateCentralStockSchema, StockTransactionSchema } from "./central-stock.schema.js";
export class CentralStockRepository {
  constructor(private db: PrismaClient) {}
  async list() {
    const centrStock = await this.db.centralStock.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quantity: true,
        supportingDocUrl: true,
        status: true,
        item:{
          select: {
            id: true,
            name: true,
            baseUnit: true,
            status: true
          }
        },
        transactions: true
      },
    });

    return centrStock.map((stock) => {
      return {
        id: stock.id,
        quantity: stock.quantity,
        supportingDocUrl: stock.supportingDocUrl,
        status: stock.status,
        item: stock.item,
        remainingStock: calculatingRemainStock(stock.transactions)
      }
    })
  }



  async create(data: CreateCentralStockSchema, userId: string) {
    return await this.db.$transaction(async(tx) => {
      return await tx.centralStock.create({
      data: {
        quantity: data.quantity,
        deportId: data.deportId,
        t1ValidationId: data.t1ValidationId,
        itemId: data.itemId,
        transactions: {
          create: {
            quantity: data.quantity,
            type: "received",
            createdBy: userId
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
    }) 
    
  }
async recentStock(centralStockId: string) {
  const transactions = await this.db.stockTransaction.findMany({
    where: {
      centralStockId,
    },
  });
  return calculatingRemainStock(transactions);
  
}


  async createStockTransaction(data: StockTransactionSchema, userId: string) {
    if (!await this.db.centralStock.findUnique({where: {id: data.centralStockId}})) throw new NotFoundError();
    const currentStock = await this.recentStock(data.centralStockId);
    if(currentStock < data.quantity && data.type === "saleOut") throw new BusinessError("400", `The Remaining Stock is ${currentStock}  but you're Requesting ${data.quantity}`);
    return await this.db.stockTransaction.create({
     data: {
       quantity: data.quantity,
       type: data.type,
       centralStockId: data.centralStockId,
       createdBy: userId
      },
    });
  }

}


  export function calculatingRemainStock(transactions: StockTransaction[]) {
    return transactions.reduce((stock, transaction) => {
    switch (transaction.type) {
      case "received":
      case "reconcilliation":
        return stock + Number(transaction.quantity);

      case "saleOut":
        return stock - Number(transaction.quantity);

      default:
        return stock;
    }
  }, 0);
    
  }