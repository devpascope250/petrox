import type { AppConfig } from "../../config/env.js";
import { DeportRepository } from "./deport.repository.js";
import { CreateDeportSchema } from "./deport.schema.js";
export class DeportService {
  constructor(private repo: DeportRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateDeportSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateDeportSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}