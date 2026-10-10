import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { generatePfiCode } from "../../utils/randomCodegen.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiRepository {
  constructor(private db: PrismaClient) {}
  async list(startDate: Date, endDate: Date) {
    return await this.db.pfi.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { createdAt: "desc" },
      select: {
      id: true,
      amount: true,
      currancyCode: true,
      currency: true,
      pifCode: true,
      pfiReference: true,
      nominationId: true,
      unitPrice: true,
      supportingDocUrl: true,
      nomination: {
        include: {
          t1Validations: {
            include: {
              extraValidations: true
            }
          }
        }
      },
      },
    });
  }

  async create(data: CreatePfiSchema) {
      const pfiCode = generatePfiCode();
      const existd = await this.findByNomination(data.nominationId);
      if (existd) throw new BusinessError("400", `The Pfi is Already Created on ${existd.pifCode}`)
        return await this.db.$transaction(async(tx) => {
      const status = await tx.nominationTimeLineStatus.findFirst({where: {status: "underLoading"}});
      if(status){
        await tx.nominationTimeLine.create({data: { nominationId: data.nominationId, timeLineStatusId: status.id, changedBy: data.createdBy }})
      }
      return await tx.pfi.create({
      data: {
        amount: data.amount,
        currancyCode: data.currancyCode,
        pfiReference: data.pfiReference,
        pifCode: pfiCode,
        currencyId: data.currencyId,
        nominationId: data.nominationId,
        unitPrice: data.unitPrice,
        supportingDocUrl: data.supportingDocUrl
      },
    });
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
        unitPrice: data.unitPrice,
        supportingDocUrl: data.supportingDocUrl
      }
    });
  }


  find(id: string) {
    return this.db.pfi.findUnique({ where: { id } });
  }
    findByNomination(nominationId: string) {
    return this.db.pfi.findFirst({ where: { nominationId } });
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
