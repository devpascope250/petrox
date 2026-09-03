import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateDriverSchema } from "./deriver.schema.js";
export class DriverRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery) {
    return this.db.$transaction([
      this.db.driver.findMany({
      ...paginationArgs(query),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
       names: true,
       lisence: true,
       passport: true,
       phone: true,
       status: true,
       createdAt: true,
       vehicles: {
         where: {
          status: "active"
         },
         select: {
          id: true,
          vechile: {
            select: {
              id: true,
              platNumber: true,
              model: true,
              status: true,
            }
          }
         }
       }
      },
      }),
      this.db.driver.count()
    ]);
  }

  create(data: CreateDriverSchema) {
    return this.db.driver.create({
      data: {
        lisence: data.lisence,
        names: data.names,
        passport: data.paassport,
        phone: data.phone,
        transporterId: data.transporterId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateDriverSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.driver.update({
      where: { id: id },
      data: {
        lisence: data.lisence,
        passport: data.paassport,
        names: data.names,
        phone: data.phone,
        transporterId: data.transporterId
      },
    });
  }

  async changeStatus(id: string) {
    const driver = await this.find(id);
    if (!driver) throw new NotFoundError();
    return await this.db.driver.update({
      where: { id },
      data: { status: driver.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.driver.findUnique({ where: { id } });
  }

  async getAllVehiclesByid(id: string) {
    return await this.db.driverVehicles.findMany({where: {driverId: id, status: "active"}});
  }

  async assignVehicles(vehicleId: string, driverId: string) {
    const vehicles = await this.getAllVehiclesByid(driverId);
    return await this.db.$transaction( async(tx) => {
      if(vehicles.length > 0) {
        const veh = vehicles.find((vh) => vh.status === "active");
        if(!veh) {
          return vehicles[0]
          }
          await tx.driverVehicles.updateMany({where: {vehicleId: vehicleId}, data: {status: "inactive"}})
          await tx.driverVehicles.updateMany({where: {driverId: driverId}, data: {status: "inactive"}})
      }

      if (await tx.vehicle.findFirst({where: {id: vehicleId, status: "inactive"}})) throw new BusinessError("400", "This vehicle is In Inactive mode")
      
     return await tx.driverVehicles.create({
      data: {
        driverId: driverId,
        vehicleId: vehicleId,
        status: "active"
      },
      select: {
        id: true,
        status:true,
        driver: {
          select: {
            id: true,
            names: true,
            lisence: true
          }
        },
        vechile: {
          select: {
            id: true,
            platNumber: true,
            model: true
          }
        }
      }
    })
    });  
  }
}
