import type { AppConfig } from "../../config/env.js";
import { CreateTransporterSchema } from "./transporter.schema.js";
import { TransporterRepository } from "./transporter.repository.js";
export class TransporterService {
  constructor(private repo: TransporterRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateTransporterSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateTransporterSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}