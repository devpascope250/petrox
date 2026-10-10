import type { AppConfig } from "../../config/env.js";
import { CentralStockRepository } from "./central-stock.repository.js";
import {
  CentralStockReportQuerySchema,
  CreateCentralStockSchema,
  StockReconciliationsBodySchema,
  StockTransactionSchema,
} from "./central-stock.schema.js";
export class CentralStockService {
  constructor(private repo: CentralStockRepository, private config: AppConfig) {
  }

  async list(query: CentralStockReportQuerySchema) {
    const report = await this.repo.list(query);
    return report.map((itemReport) => ({
      ...itemReport,
      stocks: itemReport.stocks.map((stock) => ({
        ...stock,
        supportingDocUrl: this.documentUrl(stock.supportingDocUrl),
        t1Validation: {
          ...stock.t1Validation,
          supportingDocUrl: this.documentUrl(stock.t1Validation.supportingDocUrl),
        },
        clearances: stock.clearances.map((clearance) => ({
          ...clearance,
          supportingDocUrl: this.documentUrl(clearance.supportingDocUrl),
          dmsDocUrl: this.documentUrl(clearance.dmsDocUrl),
          assessmentDocUrl: this.documentUrl(clearance.assessmentDocUrl),
        })),
        transactions: stock.transactions.map((transaction) => ({
          ...transaction,
          supportingDocUrl: this.documentUrl(transaction.supportingDocUrl),
        })),
      })),
    }));
  }

  private documentUrl(path: string | null) {
    return path ? `${this.config.APP_URL}${path}` : null;
  }


  create(input: CreateCentralStockSchema) {
    return this.repo.create(input);
  }

  async recordStatus (data: StockTransactionSchema, userId: string) {
    return await this.repo.createStockTransaction(data, userId);
  }

  async createReconsiliation (data: StockReconciliationsBodySchema) {
    return await this.repo.createReconciliation(data)
  }
}
