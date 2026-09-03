import type { AppConfig } from "../../../config/env.js";
import { ClearanceAgentRepository } from "./agent.repository.js";
import { CreateClearingAgentSchema } from "./agent.schema.js";
export class ClearanceAgentService {
  constructor(private repo: ClearanceAgentRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateClearingAgentSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateClearingAgentSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

  delete(id: string) { return this.repo.delete(id); }

}
