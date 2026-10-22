import type { CargoStatus, Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { generatePfiCode } from "../../utils/randomCodegen.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import type { CargoListQuery, CreateCargoSchema } from "./cargo.schema.js";
export class CargoRepository {
  constructor(private db: PrismaClient) {}
  /**
   * One page of the cargo list with the total behind it. Cargo accumulates for
   * as long as the company imports, so the whole list is never returned.
   */
  async list(query: CargoListQuery) {
    const { startDate, endDate, status, orderId, deportId, search } = query;
    const where: Prisma.CargoWhereInput = {
      ...(startDate || endDate
        ? { receivedDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
      ...(status ? { status } : {}),
      ...(orderId ? { orderId } : {}),
      ...(deportId ? { deportId } : {}),
      ...(search
        ? {
            OR: [
              { blRef: { contains: search } },
              { tansisRef: { contains: search } },
              { outurnRef: { contains: search } },
              { vesselName: { contains: search } },
            ],
          }
        : {}),
    };
    return this.db.$transaction([
      this.db.cargo.findMany({
      where,
      ...paginationArgs(query),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        blRef: true,
        createdAt: true,
        quantityInKg: true,
        quantityInLitre: true,
        outurnRef: true,
        receivedDate: true,
        expirationDate: true,
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
        cargoInvoices: true,
        // What its drawer lists beside the invoices.
        pfis: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, pifCode: true, pfiReference: true, currancyCode: true,
            unitPrice: true, amount: true, supportingDocUrl: true, createdAt: true,
            currency: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
      this.db.cargo.count({ where }),
    ]);
  }

  async create(data: CreateCargoSchema) {
    const order = await this.db.order.findUnique({where: {id: data.orderId}, include: {cargos: true}});
    if(data.quantityInLitre > Number(order?.quantity)) throw new BusinessError("400", "The Cargo Quantities must be less than or equal to ordered quanties.");
    const cargoStocks = order?.cargos.reduce((total, cargo) => cargo.status !== "cancelled" ? total + Number(cargo.quantityInLitre) : total, 0);
    if(cargoStocks){
      if ((data.quantityInLitre + cargoStocks) > Number(order?.quantity)) throw new BusinessError("400", "The Cargo Quantities must be less than or equal to ordered quanties.");
    }
    
    const { pfi } = data;
    return await this.db.cargo.create({
      data: {
        deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantityInKg: data.quantityInKg,
        quantityInLitre: data.quantityInLitre,
        receivedDate: data.receivedDate,
        vesselName: data.vesselName,
        status: "pending",
        tansisRef: data.tansisRef,
        outurnRef: data.outurnRef,
        supportingDocUrl: data.supportingDocUrl,
        blRef: data.blRef,
        // Raised with the shipment when the supplier's invoice came with it.
        // One write, so a refused PFI — a reference already used — leaves no
        // cargo behind either.
        ...(pfi
          ? {
              pfis: {
                create: {
                  currencyId: pfi.currencyId,
                  currancyCode: pfi.currancyCode,
                  pfiReference: pfi.pfiReference,
                  pifCode: generatePfiCode(),
                  unitPrice: pfi.unitPrice,
                  amount: pfi.amount,
                  supportingDocUrl: pfi.supportingDocUrl,
                },
              },
            }
          : {}),
      },
      include: { pfis: true },
    });
  }

  async update(id: string, data: CreateCargoSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    const order = await this.db.order.findUnique({where: {id: data.orderId}, include: {cargos: true}});
    if(data.quantityInLitre > Number(order?.quantity)) throw new BusinessError("400", "The Cargo Quantities must be less than or equal to ordered quanties.");
    const cargoStocks = order?.cargos.reduce((total, cargo) => cargo.status !== "cancelled" ? total + Number(cargo.quantityInLitre) : total, 0);
    if(cargoStocks){
      if ((data.quantityInLitre + cargoStocks) > Number(order?.quantity)) throw new BusinessError("400", "The Cargo Quantities must be less than or equal to ordered quanties.");
    }
    return await this.db.cargo.update({
      where: { id: id },
     data: {
      deportId: data.deportId,
        orderId: data.orderId,
        expirationDate: data.expirationDate,
        quantityInLitre: data.quantityInLitre,
        quantityInKg: data.quantityInKg,
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
          quantity: cargo.quantityInLitre,
          deportId: cargo.deportId,
          receivedDate,
          status: status === "approved" ? "received" : "cancelled"
        }
      })
      return await tx.cargo.update({
      where: { id , status: {equals: "pending"}},
      data: { status },
    });
    })
    
  }

  /**
   * One cargo, whole. It carries the fields an edit form binds to as well as
   * those `changeStatus` needs, so a client never has to find its row in the
   * list — which is served a page at a time and may not hold it.
   */
  find(id: string) {
    return this.db.cargo.findUnique({ where: { id }, select: {
      id: true,
      status: true,
      vesselName: true,
      receivedDate: true,
      expirationDate: true,
      blRef: true,
      tansisRef: true,
      outurnRef: true,
      orderId: true,
      quantityInLitre: true,
      quantityInKg: true,
      deportId: true,
      supportingDocUrl: true,
      order: {
        select: {
          itemId: true
        }
      },
      pfis: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, pifCode: true, pfiReference: true, currancyCode: true,
          unitPrice: true, amount: true, supportingDocUrl: true, createdAt: true,
          currency: { select: { id: true, code: true, name: true } },
        },
      },
      cargoInvoices: {
        orderBy: { createdAt: "asc" },
      },
    } });
  }

  async getAllVehiclesByid(id: string) {
    return await this.db.driverVehicles.findMany({where: {vehicleId: id, status: "active"}});
  }
}
