import { StockStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { DatesQuerySchema } from "../../shared/validation/primitives.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { NominationRepository } from "./nominations.repository.js";
import { AddNominationVesselSchema, CreateNominationsSchema } from "./nominations.schema.js";
export class NominationService {
  constructor(private repo: NominationRepository, private config: AppConfig) {
  }

  async list(date: DatesQuerySchema, itemId?: string, withoutPfi?: boolean) {
    const dates = within2DaysPeriod(date.startDate, date.endDate);
    return await this.repo.list(dates.startDate, dates.endDate, itemId, withoutPfi);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateNominationsSchema) {
    return this.repo.create(input);
  }

  async findTimeLine(id: string) {
    return this.repo.findByTimeLine(id);
  }

  async update(id: string, input: CreateNominationsSchema) {
    return await this.repo.update(id, input);
  }

  /** Loads more stock onto a nomination that already exists. */
  async addVessels(id: string, input: AddNominationVesselSchema) {
    return await this.repo.addVessels(id, input);
  }

}