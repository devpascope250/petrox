import { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { within2DaysPeriod } from "../../utils/utils.js";
import { OperationsReportRepository } from "./operations-report.repository.js";
import { DepotStockMovementReportSchema, ProcurementOrderReportSchema } from "./operations-report.schema.js";

export class OperationsReportService {
  private repository: OperationsReportRepository;
  constructor(private db: PrismaClient) {
    this.repository = new OperationsReportRepository(db);
  }

  private withDates<T extends { startDate?: Date; endDate?: Date }>(query: T) {
    return { ...query, ...within2DaysPeriod(query.startDate, query.endDate) };
  }

  getProcurementOrders = (query: ProcurementOrderReportSchema) =>
    this.repository.procurementOrders(this.withDates(query));

  getDepotStockMovement = (query: DepotStockMovementReportSchema) =>
    this.repository.depotStockMovement(this.withDates(query));
}
