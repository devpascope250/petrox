import type { AppConfig } from "../../config/env.js";
import { CentralStockRepository } from "./central-stock.repository.js";
import { CreateCentralStockSchema, StockTransactionSchema } from "./central-stock.schema.js";
export class CentralStockService {
  constructor(private repo: CentralStockRepository, private config: AppConfig) {
  }

  async list() {
    return await this.repo.list();
  
  }


  create(input: CreateCentralStockSchema) {
    return this.repo.create(input);
  }

  async recordStatus (data: StockTransactionSchema) {
    return await this.repo.createStockTransaction(data);
  }
}