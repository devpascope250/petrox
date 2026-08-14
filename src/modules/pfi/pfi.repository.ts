import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { NotFoundError } from "../../utils/errors.js";
import { generatePfiCode } from "../../utils/randomCodegen.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiRepository {
  constructor(private db: PrismaClient) {}
  async list() {
    return await this.db.pfi.findMany({
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
      amount: true,
      currancyCode: true,
      currency: true,
      pifCode: true,
      pfiReference: true,
      nominationId: true,
      rate: true
      },
    });
  }

  async create(data: CreatePfiSchema) {
      const pfiCode = generatePfiCode();
    return await this.db.pfi.create({
      data: {
        amount: data.amount,
        currancyCode: data.currancyCode,
        pfiReference: data.pfiReference,
        pifCode: pfiCode,
        currencyId: data.currencyId,
        nominationId: data.nominationId,
        rate: data.rate
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
        nominationId: data.nominationId,
        rate: data.rate
      }
    });
  }


  find(id: string) {
    return this.db.pfi.findUnique({ where: { id } });
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
