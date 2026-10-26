import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { generatePfiCode } from "../../utils/randomCodegen.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiRepository {
  constructor(private db: PrismaClient) {}
  /** One page of the PFIs raised in the window, with the total behind it. */
  async list(query: PagedDatesQuery & { startDate: Date; endDate: Date }) {
    const where = {
      createdAt: {
        gte: query.startDate,
        lte: query.endDate
      }
    };
    return this.db.$transaction([
      this.db.pfi.findMany({
      where,
      ...paginationArgs(query),
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
      amount: true,
      currancyCode: true,
      currency: true,
      pifCode: true,
      pfiReference: true,
      cargoId: true,
      unitPrice: true,
      supportingDocUrl: true,
      createdAt: true,
      // The shipment it invoices, and the order that shipment belongs to.
      // What the proforma was charged on top of its own amount.
      fees: {
        orderBy: { name: "asc" },
        select: {
          id: true, feeTypeId: true, name: true, count: true,
          unitAmount: true, currencyCode: true, createdAt: true,
        },
      },
      cargo: {
        select: {
          id: true,
          blRef: true,
          vesselName: true,
          receivedDate: true,
          status: true,
          quantityInLitre: true,
          deport: { select: { id: true, name: true } },
          order: {
            select: {
              id: true,
              orderCode: true,
              item: { select: { id: true, name: true, baseUnit: { select: { code: true } } } },
            },
          },
        },
      },
      },
    }),
      this.db.pfi.count({ where }),
    ]);
  }

  /**
   * Raises a PFI against a cargo. A shipment may be invoiced more than once —
   * the cargo's drawer lists them all — so this does not refuse a second one;
   * the reference and the generated code stay unique.
   */
  async create(data: CreatePfiSchema) {
    const cargo = await this.db.cargo.findUnique({ where: { id: data.cargoId }, select: { id: true } });
    if (!cargo) throw new NotFoundError("Cargo");
    return await this.db.pfi.create({
      data: {
        amount: data.amount,
        currancyCode: data.currancyCode,
        pfiReference: data.pfiReference,
        pifCode: generatePfiCode(),
        currencyId: data.currencyId,
        cargoId: data.cargoId,
        unitPrice: data.unitPrice,
        supportingDocUrl: data.supportingDocUrl
      },
    });
  }

  async update(id: string, data: CreatePfiSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.pfi.update({
      where: { id: id },
      data: {
        amount: data.amount,
        currancyCode: data.currancyCode,
        pfiReference: data.pfiReference,
        currencyId: data.currencyId,
        cargoId: data.cargoId,
        unitPrice: data.unitPrice,
        supportingDocUrl: data.supportingDocUrl
      }
    });
  }


  find(id: string) {
    return this.db.pfi.findUnique({ where: { id } });
  }
  /** Every PFI raised against one cargo, oldest first — what its drawer lists. */
  listByCargo(cargoId: string) {
    return this.db.pfi.findMany({
      where: { cargoId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, pifCode: true, pfiReference: true, currancyCode: true,
        unitPrice: true, amount: true, supportingDocUrl: true, createdAt: true,
        currency: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async createCurrency(data: CreateCurrancySchema) {
    return await this.db.currency.create({data});
  }
  async updateCurrency(id: string, data: CreateCurrancySchema) {
    return await this.db.currency.update({where: {id}, data});
  }

  async listCurrency() {
    return await this.db.currency.findMany();
  }
}
