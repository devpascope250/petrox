import type { AppConfig } from "../../config/env.js";
import { NotFoundError } from "../../utils/errors.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { calculatingRemainStock } from "../central-stock/central-stock.repository.js";
import { CentralStockOrderRepository } from "./order.repository.js";
import { CreateCentralStockOrderSchema } from "./order.schema.js";
export class CentralStockOrderService {
  constructor(private repo: CentralStockOrderRepository, private config: AppConfig) {}

  async list(startDate?: Date, endDate?: Date) {
    const dates = within2DaysPeriod(startDate, endDate);
    return await this.repo.list(dates.startDate, dates.endDate);
  }

  find(id: string) { return this.repo.find(id); }


  async create(input: CreateCentralStockOrderSchema) {
    const item = await this.repo.getItemsByItemIdQTYStatus(input.itemId, input.orderType === "internal" ? "cleared" : "uncleared");
        if (!item || item.length === 0) {
          throw new NotFoundError("No stock available for the specified item.");
        }
        let remainingQuantity = input.quantity;
        const removedStock: { centralStockId: string, clearanceId: string, quantity: number}[] = [];
    
        for (const s of item) {
          if (remainingQuantity <= 0) break;
          // sort the stockClearances by createdAt in ascending order
          const sortedClearances = s.stockClearances.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
           for (const clearance of sortedClearances) {
            const transactions = clearance.transactions;
            const stock = calculatingRemainStock(transactions);
            if (stock >= remainingQuantity) {
              removedStock.push({ centralStockId: s.id, clearanceId: clearance.id, quantity: remainingQuantity});
              remainingQuantity = 0;
              break; // exit the inner loop if the order is fulfilled
            } else {
              removedStock.push({ centralStockId: s.id, clearanceId: clearance.id, quantity: remainingQuantity -= stock});
              remainingQuantity -= stock;
            }
          }
        }
    
        if (remainingQuantity > 0) {
          throw new NotFoundError("Not enough stock available to fulfill the order.");
        }
        const transaction = removedStock.map((stock) => {
          return  {
            quantity: stock.quantity,
            clearanceId: stock.clearanceId,
            createdBy: input.createdBy,
          }
        });
        const orders = removedStock.map((stock) => {
          const orderData: Omit<CreateCentralStockOrderSchema, 'itemId'> = {
            clearanceId: stock.clearanceId,
            quantity: stock.quantity,
            unitPrice: input.unitPrice,
            totalPrice: stock.quantity * input.unitPrice,
            createdBy: input.createdBy,
            approvedBy: input.approvedBy,
            status: input.status,
            orderType: input.orderType,
            siteId: input.siteId
          }
          return  orderData;
        });

        return await this.repo.create(orders, transaction);
      }

}