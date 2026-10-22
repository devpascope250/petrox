import type { AppConfig } from "../../config/env.js";
import { DatesQuerySchema } from "../../shared/validation/primitives.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { PfiRepository } from "./pfi.repository.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiService {
  constructor(private repo: PfiRepository, private config: AppConfig) {
  }

  async list(query: PagedDatesQuery) {
    // No window asked for still means a window: the last two days.
    const dates = within2DaysPeriod(query.startDate, query.endDate);
    const [pfis, total] = await this.repo.list({ ...query, ...dates });
    return paginatedData(pfis.map((pfi) => this.withDocumentUrl(pfi)), total, query);
  }
  async find(id: string) {
    const pfi = await this.repo.find(id);
    return pfi ? this.withDocumentUrl(pfi) : pfi;
  }

  async create(input: CreatePfiSchema) {
    return this.withDocumentUrl(await this.repo.create(input));
  }

  async update(id: string, input: CreatePfiSchema) {
    return this.withDocumentUrl(await this.repo.update(id, input));
  }

  private withDocumentUrl<T extends { supportingDocUrl: string | null }>(pfi: T): T {
    return {
      ...pfi,
      supportingDocUrl: pfi.supportingDocUrl
        ? new URL(pfi.supportingDocUrl, this.config.APP_URL).toString()
        : null,
    };
  }

  async updateCurrency(id: string, input: CreateCurrancySchema) {
    return await this.repo.updateCurrency(id, input);
  }

  async createCurrency(data: CreateCurrancySchema) {
    return await this.repo.createCurrency(data);
  }

  async listCurrency() {
    return await this.repo.listCurrency()
  }

}
