import type { AppConfig } from "../../config/env.js";
import { NozzleRepository } from "./nozzle.repository.js";
import { CreateNozzleSchema } from "./nozzle.schema.js";

export class NozzleService {
  constructor(private repo: NozzleRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateNozzleSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateNozzleSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}