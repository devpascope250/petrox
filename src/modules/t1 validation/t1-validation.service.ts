import { CargoStatus, ExtraT1ValidationStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { DatesQuerySchema } from "../../shared/validation/primitives.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { T1ValidationRepository } from "./t1-validation.repository.js";
import { CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema } from "./t1-validation.schema.js";
export class T1ValidationSrvice {
  constructor(private repo: T1ValidationRepository, private config: AppConfig) {
  }

  async listByCompleted() {
    const t1 = await this.repo.listByCompleted();
    return t1.map((al) => {
      return  {
        ...al,
        supportingDocUrl: `${this.config.APP_URL}${al.supportingDocUrl}`
      }
    })
  }

    async list(date: DatesQuerySchema) {
    const dates = within2DaysPeriod(date.startDate, date.endDate);
    const t1 = await this.repo.list(dates.startDate, dates.endDate);
    return t1.map((al) => {
      return  {
        ...al,
        supportingDocUrl: `${this.config.APP_URL}${al.supportingDocUrl}`
      }
    })
  }

  async find(id: string) { 
    const cargo = await this.repo.find(id);
    return {
      ...cargo,
      supportingDocUrl: `${this.config.APP_URL}${cargo?.supportingDocUrl}`
    }; 
  }

  create(input: CreateT1ValidationsSchema) {
    return this.repo.create(input);
  }

  createExtraT1(input: CreateExtraT1ValidationsSchema) {
    return this.repo.createExtraT1(input);
  }

  async update(id: string, extraT1Id: string, input: CreateT1ValidationsSchema) {
    return await this.repo.update(id, extraT1Id, input);
  }

  async updateStatus (id: string, status: ExtraT1ValidationStatus, createdAt?: string) {
    return await this.repo.changeStatus(id, status, createdAt);
  }

}