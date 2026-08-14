import type { CargoStatus, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateCargoSchema, FileSchema } from "./cargo.schema.js";
export class CargoRepository {
  constructor(private db: PrismaClient) {}
  async list() {
    return await this.db.cargo.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        blRef: true,
        createdAt: true,
        expirationDate: true,
        quantity: true,
        outurnRef: true,
        receivedDate: true,
        supportingDocUrl: true,
        tansisRef: true,
        vesselName: true,
        order: true,
        deport: true,
        stocks: {
          select: {
            id: true,
            item: true,
            quantity: true,
            receivedDate: true,
            status: true,
            itemId: true
          }
        },

      },
    });
  }

  async create(data: CreateCargoSchema) {
    const order = await this.db.order.findUnique({where: {id: data.orderId}});
    if(data.quantity > Number(order?.quantity)) throw new BusinessError("400", "The Cargo Quantities must be less than or equal to ordered quanties.");
    return await this.db.cargo.create({
      data: {
        deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantity: data.quantity,
        receivedDate: data.receivedDate,
        vesselName: data.vesselName,
        status: "pending",
        tansisRef: data.tansisRef,
        outurnRef: data.outurnRef,
        supportingDocUrl: data.supportingDocUrl,
        blRef: data.blRef
      },
    });
  }

  async update(id: string, data: CreateCargoSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.cargo.update({
      where: { id: id },
     data: {
      deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantity: data.quantity,
        receivedDate: data.receivedDate,
        vesselName: data.vesselName,
        tansisRef: data.tansisRef,
        outurnRef: data.outurnRef,
        supportingDocUrl: data.supportingDocUrl,
        blRef: data.blRef
      },
    });
  }

  async changeStatus(id: string, status: CargoStatus, receivedDate: Date) {
    const cargo = await this.find(id);
    if (!cargo) throw new NotFoundError();
    return await this.db.$transaction(async(tx) => {
      await tx.stock.create({
        data: {
          itemId: cargo.order.itemId,
          cargoId: id,
          quantity: cargo.quantity,
          deportId: cargo.deportId,
          receivedDate,
          status: status === "approved" ? "received" : "cancelled"
        }
      })
      return await tx.cargo.update({
      where: { id },
      data: { status },
    });
    })
    
  }

  find(id: string) {
    return this.db.cargo.findUnique({ where: { id }, select: {
      quantity: true,
      deportId: true,
      order: {
        select: {
          itemId: true
        }
      }
    } });
  }

  async getAllVehiclesByid(id: string) {
    return await this.db.driverVehicles.findMany({where: {vehicleId: id, status: "active"}});
  }
}
