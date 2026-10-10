import type { AppConfig } from "../../config/env.js";
import { StockClearanceRepository } from "./clearance.repository.js";
import { CreateStockClearanceSchema } from "./clearance.schema.js";
export class StockClearanceService {
  constructor(private repo: StockClearanceRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateStockClearanceSchema) {
    return this.repo.create(input);
  }

}