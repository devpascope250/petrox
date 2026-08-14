import type { CargoStatus, ExtraT1ValidationStatus, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema } from "./t1-validation.schema.js";
export class T1ValidationRepository {
  constructor(private db: PrismaClient) {}
  async list() {
    return await this.db.t1Validation.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exportingCountry: true,
        extraValidations: true,
        supportingDocUrl: true,
        nomination: {
          select: {
            id: true,
            quantity: true,
            stockId: true,
            timeLine: true,
            stock: {
              select: {
                item: true
              }
            }
          }
        }
      },
    });
  }

  async create(data: CreateT1ValidationsSchema) {
    return await this.db.$transaction(async(tx) => {
      return await tx.t1Validation.create({
      data: {
        exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        extraValidations: {
          create: {
            customOffice: data.customOffice,
            transitNumbering: data.transitNumbering
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
        transitNumbering: data.transitNumbering
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
        extraValidations: {
          update: {
            where: {id: extraT1Id},
            data: {customOffice: data.customOffice, transitNumbering: data.transitNumbering}
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
  }

  async changeStatus(id: string, status: ExtraT1ValidationStatus) {
    const t1 = await this.findExt(id);
    if (!t1) throw new NotFoundError();
      return await this.db.extraT1Validation.update({
      where: { id },
      data: { status },
    });
  }

  find(id: string) {
    return this.db.t1Validation.findUnique({ where: { id } });
  }

   findExt(id: string) {
    return this.db.extraT1Validation.findUnique({ where: { id } });
  }

}
