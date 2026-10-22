import { StockStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { DatesQuerySchema } from "../../shared/validation/primitives.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { NominationRepository } from "./nominations.repository.js";
import { AddNominationVesselSchema, CreateNominationsSchema, NominationListQuerySchema } from "./nominations.schema.js";
export class NominationService {
  constructor(private repo: NominationRepository, private config: AppConfig) {
  }

  async list(query: NominationListQuerySchema) {
    // No window asked for still means a window: the last two days.
    const dates = within2DaysPeriod(query.startDate, query.endDate);
    const [items, total] = await this.repo.list({ ...query, ...dates });
    return paginatedData(items, total, query);
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