import type { PrismaClient, StockStatus } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateStockSchema } from "./stock.schema.js";
export class StockRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.stock.findMany({
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
       quantity: true,
       receivedDate: true,
       status: true,
       cargo: {
        select: {
          id: true,
          quantity: true,
          receivedDate: true,
          status: true,
          vesselName: true
        }
       },
       deport: {
        select: {
          id: true,
          name: true,
          status: true,
          location: true
        }
       },
       item: true
      },
    });
  }

  // create(data: CreateStockSchema) {
  //   return this.db.stock.create({
  //     data: {

  //       cargoId: data.cargoId,
  //       deportId: data.deportId,
  //       quantity: data.quantity,
  //       receivedDate: data.receivedDate,
  //       status: data.status    
  //     },
  //   });
  // }

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
