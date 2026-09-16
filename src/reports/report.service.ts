import { PrismaClient } from "../../prisma/generated/prisma/client.js";
import { within2DaysPeriod } from "../utils/utils.js";
import { ReportRepository } from "./report.repository.js";
import { CentralStockReportSchema, CentralStockTransactionReportSchema, ReportOrderSchema } from "./report.schema.js";

export class ReportService {
  private repository: ReportRepository;
  constructor(private db: PrismaClient) {
    this.repository = new ReportRepository(db);
  }

  private withDates<T extends { startDate?: Date; endDate?: Date }>(query: T) {
    return { ...query, ...within2DaysPeriod(query.startDate, query.endDate) };
  }

  getOrderReportDetails = async (query: ReportOrderSchema) => {
    const datedQuery = this.withDates(query);
    const [summary, details] = await Promise.all([
      this.repository.supplyChainOrderSummary(datedQuery),
      this.repository.supplyChainOrderDetails(datedQuery),
    ]);

    return {
      summary,
      details,
    };
  };

  getOrderReportBySupplyer = async (query: ReportOrderSchema) => {
    const datedQuery = this.withDates(query);
    const [summary, details] = await Promise.all([
      this.repository.supplyChainOrderSummary(datedQuery),
      this.repository.supplyChainOrdersBySupplier(datedQuery),
    ]);

    return {
      summary,
      details,
    };
  };

  getOrderReportByItems = async (query: ReportOrderSchema) => {
    const datedQuery = this.withDates(query);
    const [summary, details] = await Promise.all([
      this.repository.supplyChainOrderSummary(datedQuery),
      this.repository.supplyChainOrdersByItem(datedQuery),
    ]);

    return {
      summary,
      details,
    };
  };

  getOrderReportByDeport = async (query: ReportOrderSchema) => {
    const datedQuery = this.withDates(query);
    const [summary, details] = await Promise.all([
      this.repository.supplyChainOrderSummary(datedQuery),
      this.repository.supplyChainOrdersByDeport(datedQuery),
    ]);

    return {
      summary,
      details,
    };
  };

  getOrderReportByOrderPlan = async (query: ReportOrderSchema) => {
    const datedQuery = this.withDates(query);
    const [summary, details] = await Promise.all([
      this.repository.supplyChainOrderSummary(datedQuery),
      this.repository.supplyChainOrdersByOrderPlan(datedQuery),
    ]);

    return {
      summary,
      details,
    };
  };

  getCentralStockReport = (query: CentralStockReportSchema) =>
    this.repository.centralStockReport(this.withDates(query));

  getCentralStockTransactions = (query: CentralStockTransactionReportSchema) =>
    this.repository.centralStockTransactions(this.withDates(query));
}
