import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateVehicleSchema } from "./vehicles.schema.js";
export class VehicleRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.vehicle.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platNumber: true,
        model: true,
        status: true,
        tankCapacity: true,
        truckNumber: true,
        trailerNumber: true,
        transporterId: true,
        transport: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      },
    });
  }

  create(data: CreateVehicleSchema) {
    return this.db.vehicle.create({
      data: {
        model: data.model,
        platNumber: data.platNumber,
        tankCapacity: data.tankCapacity,
        trailerNumber: data.trailerNumber,
        truckNumber: data.truckNumber,
        transporterId: data.transporterId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateVehicleSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.vehicle.update({
      where: { id: id },
      data: {
        ...data
      },
    });
  }

  async changeStatus(id: string) {
    const veh = await this.find(id);
    if (!veh) throw new NotFoundError();
    return await this.db.vehicle.update({
      where: { id },
      data: { status: veh.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.vehicle.findUnique({ where: { id } });
  }
}
