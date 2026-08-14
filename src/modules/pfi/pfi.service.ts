import type { AppConfig } from "../../config/env.js";
import { PfiRepository } from "./pfi.repository.js";
import { CreateCurrancySchema, CreatePfiSchema } from "./pfi.schema.js";
export class PfiService {
  constructor(private repo: PfiRepository, private config: AppConfig) {
  }

  async list() {
    return await this.repo.list();
  }
  find(id: string) { return this.repo.find(id); }

  async create(input: CreatePfiSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreatePfiSchema) {
    return await this.repo.update(id, input);
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