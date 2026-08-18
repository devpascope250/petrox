import type { AppConfig } from "../../config/env.js";
import { DisplayRepository } from "./display.repository.js";
import { CreateDisplaySchema } from "./display.schema.js";
export class DisplayService {
  constructor(private repo: DisplayRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateDisplaySchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateDisplaySchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}