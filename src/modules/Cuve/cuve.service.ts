import type { AppConfig } from "../../config/env.js";
import { CuveRepository } from "./cuve.repository.js";
import { CreateCuveSchema } from "./cuve.schema.js";
export class CuveService {
  constructor(private repo: CuveRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateCuveSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateCuveSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}