import type { ExtraT1ValidationStatus, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema } from "./t1-validation.schema.js";
export class T1ValidationRepository {
  constructor(private db: PrismaClient) {}
  async listByCompleted() {
    return await this.db.t1Validation.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        extraValidations: { some: { status: "confirmed" } },
        // A confirmed T1 validation must be selectable only until it has been
        // used to create central stock.
        centralStocks: { none: {} },
      },
      select: {
        id: true,
        exportingCountry: true,
        extraValidations: true,
        supportingDocUrl: true,
        nomination: {
          select: {
            id: true,
            ambQuantity: true,
            timeLine: true,
            // A nomination can load from several vessels now, so the stock and
            // its item come through the vessel list rather than one `stock`.
            nominationVessels: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                stockId: true,
                ambQuantity: true,
                stock: {
                  select: {
                    item: true
                  }
                }
              }
            }
          }
        }
      },
    });
  }

  async list(startDate: Date, endDate: Date) {
    return await this.db.t1Validation.findMany({
      orderBy: { createdAt: "desc" },
      where: {createdAt: {gte: startDate, lte: endDate}},
      select: {
        id: true,
        exportingCountry: true,
        extraValidations: true,
        supportingDocUrl: true,
        nomination: {
          select: {
            id: true,
            ambQuantity: true,
            timeLine: true,
            // A nomination can load from several vessels now, so the stock and
            // its item come through the vessel list rather than one `stock`.
            nominationVessels: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                stockId: true,
                ambQuantity: true,
                stock: {
                  select: {
                    item: true
                  }
                }
              }
            }
          }
        }
      },
    });
  }

  async create(data: CreateT1ValidationsSchema) {
    if ((await this.findByNomination(data.nominationId))) throw new BusinessError("400", "The Validation is Already Existed!");
    return await this.db.$transaction(async(tx) => {
       const status = await tx.nominationTimeLineStatus.findFirst({where: {status: "t1Pending"}});
      if(status){
        await tx.nominationTimeLine.create({data: { nominationId: data.nominationId, timeLineStatusId: status.id, changedBy: data.createdBy }})
      }
      return await tx.t1Validation.create({
      data: {
        exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        quantityAt20C: data.quantityAt20C,
        extraValidations: {
          create: {
            customOffice: data.customOffice,
            // transitNumbering: data.transitNumbering
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
    }) 
    
  }

  async createExtraT1(data: CreateExtraT1ValidationsSchema) {
      return await this.db.extraT1Validation.create({
      data: {
        t1ValidationId: data.t1ValidationId,
        customOffice: data.customOffice,
        // transitNumbering: data.transitNumbering
      },
    });
  }

  async update(id: string, extraT1Id: string, data: CreateT1ValidationsSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.t1Validation.update({
      where: { id: id },
     data: {
       exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        quantityAt20C: data.quantityAt20C,
        extraValidations: {
          update: {
            where: {id: extraT1Id},
            data: {customOffice: data.customOffice}
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
  }

  async changeStatus(id: string, stat: ExtraT1ValidationStatus, createdBy?: string) {
    const t1 = await this.findExt(id);
    if (!t1) throw new NotFoundError();
    if(t1.status !== "pending") throw new BusinessError("400", "The Status Can not be changed since is not pending")
      return await this.db.$transaction( async(tx) => {
     const status = await tx.nominationTimeLineStatus.findFirst({where: {status: "t1Confirmed"}});
      if(status){
        await tx.nominationTimeLine.create({data: { nominationId: t1.validation.nominationId, timeLineStatusId: status.id, changedBy: createdBy }})
      }

       return await tx.extraT1Validation.update({
      where: { id },
      data: { status: stat },
    });
    })
     
  }

  find(id: string) {
    return this.db.t1Validation.findUnique({ where: { id } });
  }

  async findByNomination(id: string) {
    return await this.db.t1Validation.findFirst({ where: { nominationId: id } });
  }

   findExt(id: string) {
    return this.db.extraT1Validation.findUnique({ where: { id }, select: {t1ValidationId: true, id: true, status: true, validation: {select: {nominationId: true}}} });
  }

}
