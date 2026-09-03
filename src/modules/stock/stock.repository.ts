import type { PrismaClient, StockStatus } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateStockSchema, StockReportQuerySchema } from "./stock.schema.js";
export class StockRepository {
  constructor(private db: PrismaClient) {}

  async list(query: StockReportQuerySchema & { startDate: Date; endDate: Date }) {
    const { startDate, endDate, status } = query;
    const depotId = query.depotId ?? query.deportId;
    const stocks = await this.db.stock.findMany({
      where: {
        receivedDate: {
          gte: startDate,
          lte: endDate,
        },
        ...(status && { status }),
        ...(depotId && { deportId: depotId }),
      },
      orderBy: { receivedDate: "desc" },
      select: {
        id: true,
        quantity: true,
        receivedDate: true,
        status: true,
        cargo: {
          select: {
            id: true,
            blRef: true,
            vesselName: true,
            ambQuantity: true,
            quantityAt20C: true,  
            receivedDate: true,
            expirationDate: true,
            status: true,
          },
        },
        deport: {
          select: {
            id: true,
            name: true,
            location: true,
            type: true,
            status: true,
          },
        },
        item: {
          select: {
            id: true,
            name: true,
            descriptions: true,
            status: true,
            baseUnit: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        nominations: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            ambQuantity: true,
            quantityAt20C: true,
            destination: true,
            expectedLoadingDate: true,
            driverVehicle: {
              select: {
                driver: {
                  select: {
                    id: true,
                    names: true,
                    phone: true,
                    lisence: true,
                    passport: true,
                  },
                },
                vechile: {
                  select: {
                    id: true,
                    platNumber: true,
                    truckNumber: true,
                    trailerNumber: true,
                    model: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const report = new Map<string, {
      item: typeof stocks[number]["item"];
      summary: {
        totalQuantity: number;
        nominatedQuantity: number;
        remainingQuantity: number;
        stockCount: number;
        quantitiesByStatus: Record<string, number>;
      };
      stocks: Array<{
        id: string;
        quantityBeforeNominations: number;
        nominatedQuantity: number;
        remainingQuantity: number;
        receivedDate: Date;
        status: typeof stocks[number]["status"];
        cargo: typeof stocks[number]["cargo"];
        depot: typeof stocks[number]["deport"];
        nominations: Array<{
          id: string;
          quantity: number;
          destination: string;
          expectedLoadingDate: Date;
          driver: typeof stocks[number]["nominations"][number]["driverVehicle"]["driver"];
          vehicle: typeof stocks[number]["nominations"][number]["driverVehicle"]["vechile"];
        }>;
      }>;
    }>();

    for (const stock of stocks) {
      let itemReport = report.get(stock.item.id);

      if (!itemReport) {
        itemReport = {
          item: stock.item,
          summary: {
            totalQuantity: 0,
            nominatedQuantity: 0,
            remainingQuantity: 0,
            stockCount: 0,
            quantitiesByStatus: {},
          },
          stocks: [],
        };
        report.set(stock.item.id, itemReport);
      }

      const quantity = Number(stock.quantity);
      const nominations = stock.nominations.map((nomination) => ({
        id: nomination.id,
        quantity: Number(nomination.quantityAt20C),
        destination: nomination.destination,
        expectedLoadingDate: nomination.expectedLoadingDate,
        driver: nomination.driverVehicle.driver,
        vehicle: nomination.driverVehicle.vechile,
      }));
      const nominatedQuantity = nominations.reduce(
        (total, nomination) => total + nomination.quantity,
        0,
      );
      const remainingQuantity = quantity - nominatedQuantity;

      itemReport.summary.totalQuantity += quantity;
      itemReport.summary.nominatedQuantity += nominatedQuantity;
      itemReport.summary.remainingQuantity += remainingQuantity;
      itemReport.summary.stockCount += 1;
      itemReport.summary.quantitiesByStatus[stock.status] =
        (itemReport.summary.quantitiesByStatus[stock.status] ?? 0) + quantity;

      itemReport.stocks.push({
        id: stock.id,
        quantityBeforeNominations: quantity,
        nominatedQuantity,
        remainingQuantity,
        receivedDate: stock.receivedDate,
        status: stock.status,
        cargo: stock.cargo,
        // The database relation is named `deport`; expose it as the correctly
        // spelled `depot` in the report API.
        depot: stock.deport,
        nominations,
      });
    }

    return Array.from(report.values());
  }

  async update(id: string, data: CreateStockSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.stock.update({
      where: { id: id },
      data: {
        cargoId: data.cargoId,
        deportId: data.deportId,
        quantity: data.quantity,
        receivedDate: data.receivedDate,
        status: data.status    
      }
    });
  }

  async changeStatus(id: string, status: StockStatus) {
    const stock = await this.find(id);
    if (!stock) throw new NotFoundError();
    return await this.db.stock.update({
      where: { id },
      data: { status: status },
    });
  }

  find(id: string) {
    return this.db.stock.findUnique({ where: { id } });
  }
  async update(id: string, data: CreateStockSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.stock.update({
      where: { id: id },
      data: {
        cargoId: data.cargoId,
        deportId: data.deportId,
        quantity: data.quantity,
        receivedDate: data.receivedDate,
        status: data.status    
      }
    });
  }

}
