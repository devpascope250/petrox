import type { PrismaClient, StockStatus } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateNominationsSchema } from "./nominations.schema.js";
export class NominationRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.nomination.findMany({
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
       quantity: true,
       destination: true,
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
          }
        }
       }
      },
    });
  }

  create(data: CreateNominationsSchema) {
    return this.db.nomination.create({
      data: {
        stockId: data.stockId,
        destination: data.destination,
        quantity: data.quantity,
        expectedLoadingDate: data.expectedLoadingedDate,
        driverVehicleId: data.driverVehicleId

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
        quantity: data.quantity,
        expectedLoadingDate: data.expectedLoadingedDate,
        driverVehicleId: data.driverVehicleId

      }
    });
  }


  find(id: string) {
    return this.db.nomination.findUnique({ where: { id } });
  }

}
