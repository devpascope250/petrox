import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateDriverSchema, type DriverListQuery } from "./deriver.schema.js";
export class DriverRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Drivers with their active trucks. Each truck carries its tank capacity and
   * how much is already nominated on it but not yet delivered — the same rule
   * nominations enforce — so a form can show the space left before submitting.
   */
  async list(query: DriverListQuery) {
    const where = this.matching(query.search, query.status);
    const [drivers, total] = await this.db.$transaction([
      this.db.driver.findMany({
      where,
      ...paginationArgs(query),
      /*
       * The id breaks the tie, and has to.
       *
       * `createdAt` alone is not a total order: a bulk import writes many
       * drivers in the same millisecond, and MySQL is then free to order those
       * rows differently between queries — so the same driver could appear on
       * two pages while another appeared on none.
       */
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
       names: true,
       lisence: true,
       passport: true,
       phone: true,
       status: true,
       createdAt: true,
       transporterId: true,
       // The company the driver works for, shown on the list.
       transport: { select: { id: true, name: true } },
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
              tankCapacity: true,
              // A truck is known by its body and trailer numbers as much as by
              // its plate, and a nomination is searched for by all three.
              truckNumber: true,
              trailerNumber: true,
            }
          },
          nominations: {
            where: { timeLine: { none: { timeLineStatus: { status: "stockReceived" } } } },
            select: { ambQuantity: true },
          },
         }
       }
      },
      }),
      // The same `where`: a total counted over everything would page a
      // search result into pages that are mostly empty.
      this.db.driver.count({ where })
    ]);
    const items = drivers.map((driver) => ({
      ...driver,
      vehicles: driver.vehicles.map(({ nominations, vechile, ...assignment }) => {
        const tankCapacity = Number(vechile.tankCapacity);
        const nominatedQuantity = nominations.reduce((sum, row) => sum + Number(row.ambQuantity), 0);
        return {
          ...assignment,
          vechile: { ...vechile, tankCapacity },
          /** Nominated on this truck and not yet delivered. */
          nominatedQuantity,
          /** What still fits in the tank. */
          availableCapacity: Math.max(0, tankCapacity - nominatedQuantity),
        };
      }),
    }));
    return [items, total] as const;
  }

  /**
   * What a typed search matches: the driver, the documents he is known by, and
   * the company he drives for — the same things the page shows in its columns,
   * so a search for what is on screen finds it.
   *
   * MySQL compares these columns case-insensitively by its own collation, so
   * no `mode` is needed (and Prisma's MySQL connector does not take one).
   */
  private matching(search?: string, status?: "active" | "inactive"): Prisma.DriverWhereInput {
    const term = search?.trim();
    return {
      ...(status ? { status } : {}),
      ...(term
        ? {
            OR: [
              { names: { contains: term } },
              { phone: { contains: term } },
              { lisence: { contains: term } },
              { passport: { contains: term } },
              { transport: { is: { name: { contains: term } } } },
              /*
               * The trucks assigned to him. A driver is very often looked up
               * by the vehicle rather than by his own name — "who is on
               * RAB 123 F" — and a trailer number is what is written on the
               * paperwork at the depot.
               */
              { vehicles: { some: { vechile: { platNumber: { contains: term } } } } },
              { vehicles: { some: { vechile: { truckNumber: { contains: term } } } } },
              { vehicles: { some: { vechile: { trailerNumber: { contains: term } } } } },
            ],
          }
        : {}),
    };
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

  /** A driver only drives the trucks of the transporter he works for. */
  async assignVehicles(vehicleId: string, driverId: string) {
    const [driver, vehicle] = await Promise.all([
      this.db.driver.findUnique({ where: { id: driverId }, select: { transporterId: true, transport: { select: { name: true } } } }),
      this.db.vehicle.findUnique({ where: { id: vehicleId }, select: { transporterId: true, platNumber: true } }),
    ]);
    if (!driver) throw new NotFoundError("Driver");
    if (!vehicle) throw new NotFoundError("Vehicle");
    if (vehicle.transporterId !== driver.transporterId) {
      throw new BusinessError("VEHICLE_OTHER_TRANSPORTER",
        `${vehicle.platNumber} does not belong to ${driver.transport?.name ?? "the driver's transporter"}`, 422);
    }
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
