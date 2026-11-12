import type { PrismaClient, StockStatus } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateStockSchema, StockReportQuerySchema } from "./stock.schema.js";
import { usageOf } from "./stock-taken.js";
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
            quantityInKg: true,
            quantityInLitre: true, 
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
        nominationVessels: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            ambQuantity: true,
            nomination: {
              select: {
                id: true,
                destination: true,
                expectedLoadingDate: true,
                ambQuantity: true,
                // What the trip actually took, once customs measured it —
                // see `stock-taken`. The batch is drawn down by this, not by
                // what the nomination planned.
                t1Validations: { select: { quantityAt20C: true } },
                nominationVessels: { select: { ambQuantity: true } },
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
        },
      },
    });

    const report = new Map<string, {
      item: typeof stocks[number]["item"];
      summary: {
        totalQuantity: number;
        /** Planned on trips whose T1 is not in yet. Holds nothing back. */
        nominatedQuantity: number;
        /** Confirmed gone, from the T1s of the trips that loaded from it. */
        takenQuantity: number;
        remainingQuantity: number;
        stockCount: number;
        quantitiesByStatus: Record<string, number>;
        /**
         * Litres that are on record but are no longer stock: a batch whose
         * cargo was cancelled, or sent back to the supplier. Reported beside
         * the totals rather than inside them, so the figures still add up.
         */
        withdrawnQuantity: number;
        /**
         * What is left on batches that have been closed: the 20 °C residue of
         * a batch whose trips are done. Real litres on paper, but not fuel
         * anybody can load, so it is reported apart from what is available.
         */
        closedResidueQuantity: number;
      };
      stocks: Array<{
        id: string;
        quantityBeforeNominations: number;
        nominatedQuantity: number;
        takenQuantity: number;
        remainingQuantity: number;
        receivedDate: Date;
        status: typeof stocks[number]["status"];
        cargo: typeof stocks[number]["cargo"];
        depot: typeof stocks[number]["deport"];
        nominations: Array<{
          id: string;
          vesselId: string;
          quantity: number;
          nominationQuantity: number;
          destination: string;
          expectedLoadingDate: Date;
          driver: typeof stocks[number]["nominationVessels"][number]["nomination"]["driverVehicle"]["driver"];
          vehicle: typeof stocks[number]["nominationVessels"][number]["nomination"]["driverVehicle"]["vechile"];
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
            takenQuantity: 0,
            remainingQuantity: 0,
            stockCount: 0,
            quantitiesByStatus: {},
            withdrawnQuantity: 0,
            closedResidueQuantity: 0,
          },
          stocks: [],
        };
        report.set(stock.item.id, itemReport);
      }

      const quantity = Number(stock.quantity);
      // A nomination can load from several vessels, so `quantity` here is the
      // slice drawn from *this* stock, not the nomination's whole volume.
      const nominations = stock.nominationVessels.map(({ nomination, ...vessel }) => ({
        id: nomination.id,
        vesselId: vessel.id,
        quantity: Number(vessel.ambQuantity),
        nominationQuantity: Number(nomination.ambQuantity),
        destination: nomination.destination,
        expectedLoadingDate: nomination.expectedLoadingDate,
        driver: nomination.driverVehicle.driver,
        vehicle: nomination.driverVehicle.vechile,
      }));
      /*
       * A batch is drawn down by the **T1s** of the trips that loaded from it,
       * not by what those trips nominated: a nomination is a plan and moves no
       * fuel. `nominated` is what is still only planned, shown beside the rest
       * because somebody about to load will want to know about it.
       */
      const { taken: takenQuantity, nominated: nominatedQuantity, available: remainingQuantity } =
        usageOf(stock.quantity, stock.nominationVessels);

      /*
       * A withdrawn batch is still listed — it is part of the history of the
       * depot — but it is not stock, so it stays out of the totals. It used to
       * be added to `totalQuantity` like any other row, which meant a
       * cancelled cargo went on inflating the depot's volume for ever.
       */
      const withdrawn = stock.status === "returned" || stock.status === "cancelled";
      if (withdrawn) {
        itemReport.summary.withdrawnQuantity += quantity;
      } else {
        itemReport.summary.totalQuantity += quantity;
        itemReport.summary.nominatedQuantity += nominatedQuantity;
        itemReport.summary.takenQuantity += takenQuantity;
        /*
         * A closed batch keeps its own figures on its row — the fuel really
         * arrived and really left — but what is left on it is the 20 °C
         * residue, which nobody can load. So it is reported apart rather than
         * counted as available.
         */
        if (stock.status === "closed") {
          itemReport.summary.closedResidueQuantity += remainingQuantity;
        } else {
          itemReport.summary.remainingQuantity += remainingQuantity;
        }
      }
      itemReport.summary.stockCount += 1;
      itemReport.summary.quantitiesByStatus[stock.status] =
        (itemReport.summary.quantitiesByStatus[stock.status] ?? 0) + quantity;

      itemReport.stocks.push({
        id: stock.id,
        quantityBeforeNominations: quantity,
        nominatedQuantity,
        takenQuantity,
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
}
