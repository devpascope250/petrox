import type { AppConfig } from "../../config/env.js";
import { PumpRepository } from "./pump.repository.js";
import {CreatePumpSchema } from "./pump.schema.js";
export class PumpService {
  constructor(private repo: PumpRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreatePumpSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreatePumpSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}