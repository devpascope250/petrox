import type { AppConfig } from "../../config/env.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { NozzleRepository } from "./nozzle.repository.js";
import { CreateNozzleSchema, NozzleListQuery } from "./nozzle.schema.js";

export class NozzleService {
  constructor(private repo: NozzleRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  async listPage(query: NozzleListQuery) {
    const [items, total] = await this.repo.listPage(query);
    return paginatedData(items, total, query);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateNozzleSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateNozzleSchema) {
    return await this.repo.update(id, input);
  }


  /** What a scanned code is bound to, for checking before binding; `null` when free. */
  findByCode(code: string) { return this.repo.findByCode(code); }

  bindCode(id: string, nozzleCode: string) { return this.repo.bindCode(id, nozzleCode); }

  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}