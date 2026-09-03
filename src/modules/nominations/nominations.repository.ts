import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateNominationsSchema } from "./nominations.schema.js";
export class NominationRepository {
  constructor(private db: PrismaClient) {}

  async list(startDate: Date, endDate: Date, itemId?: string) {
    return await this.db.nomination.findMany({
      where: {
        stock: {
          ...(itemId ? { itemId: itemId } : {})
        },
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
       ambQuantity: true,
       quantityAt20C: true,
       destination: true,
       stock: {
        select: {
          cargo: true,
          item: true
        }
       },
       driverVehicle: {
        select: {
          driver: {
            select: {
              names: true,
              phone: true,
              passport: true,
              lisence: true,
            }
          },
          vechile: {
            select: {
              id: true,
              model: true,
              platNumber: true,
              tankCapacity: true,
              trailerNumber: true,
              truckNumber: true,
              createdAt: true
            }
          },
        }
       }
      },
    });
  }

  async create(data: CreateNominationsSchema) {
    const getstatus = await this.db.nominationTimeLineStatus.findFirst({where: {status: "awaiting"}});
    if (!getstatus) throw new NotFoundError("The nomination status must be registered before")
      const stock = await this.findNominationsAndCompareStock(data.stockId, data.quantityAt20C);
    if(stock) throw new BusinessError("400", "The Nominations Qty can not be greater than stock quantity!")
    return await this.db.nomination.create({
      data: {
        stockId: data.stockId,
        destination: data.destination,
        quantityAt20C: data.quantityAt20C,
        ambQuantity: data.ambQuantity,
        expectedLoadingDate: data.expectedLoadingedDate,
        driverVehicleId: data.driverVehicleId,
        timeLine: {
          create: {
            timeLineStatusId: getstatus?.id,
            changedBy: data.createdBy
          }
        }
        
      },
    });
  }

  async update(id: string, data: CreateNominationsSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.nomination.update({
      where: { id: id },
      data: {
        stockId: data.stockId,
        destination: data.destination,
        quantityAt20C: data.quantityAt20C,
        ambQuantity: data.ambQuantity,
        expectedLoadingDate: data.expectedLoadingedDate,
        driverVehicleId: data.driverVehicleId

      }
    });
  }

  async findNominationsAndCompareStock(id: string, quantity: number) {
    const stock = await this.db.stock.findFirst({
      where: {id},
      select: {quantity: true, nominations: {select: {quantityAt20C: true}}}
    });

    const currentQty = Number(stock?.nominations.reduce((total, stoc) => total + Number(stoc.quantityAt20C), 0)) + quantity;

    return currentQty > Number(stock?.quantity);
  }


  find(id: string) {
    return this.db.nomination.findUnique({ where: { id } });
  }

  async findByTimeLine(nominationId: string) {
    const timeLine = await this.db.nominationTimeLine.findMany(
      {
        where: {nominationId},
      select: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          }
        },
        timeLineStatus: {
          select:{
            id: true,
            level: true,
            status: true,
            descriptions: true
          },
           
        },
        createdAt: true,
      },
      orderBy: {
        timeLineStatus: {
          level: "asc"
        }
      }
      }
    );

    return timeLine.map((entry) => {
      const descriptions = entry.timeLineStatus.descriptions
        .split(",")
        .map((description) => description.trim())
        .filter(Boolean);

      return {
        id: entry.timeLineStatus.id,
        status: entry.timeLineStatus.status,
        level: entry.timeLineStatus.level,
        descriptions,
        createdAt: entry.createdAt,
        createdBy: entry.user
          ? `${entry.user.firstName} ${entry.user.lastName}`.trim()
          : null
      }
    });
  }

}
