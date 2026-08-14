import { StockStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { StockRepository } from "./stock.repository.js";
import { CreateStockSchema } from "./stock.schema.js";
export class StockService {
  constructor(private repo: StockRepository, private config: AppConfig) {
  }

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  // async create(input: CreateStockSchema) {
  //   return this.repo.create(input);
  // }

  async update(id: string, input: CreateStockSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string, status: StockStatus) {
    return await this.repo.changeStatus(id, status);
  }
}