import { afterEach, describe, expect, it, vi } from "vitest";
import {
  centralStockReportSchema,
  centralStockTransactionReportSchema,
  reportOrderSchema,
} from "../src/reports/report.schema.js";
import { ReportService } from "../src/reports/report.service.js";

afterEach(() => vi.useRealTimers());

describe("supply-chain report queries", () => {
  it("applies bounded pagination and inclusive date-only end dates", () => {
    const query = reportOrderSchema.parse({ page: "2", pageSize: "50",
      startDate: "2026-09-01", endDate: "2026-09-15" });
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(50);
    expect(query.startDate).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(query.endDate).toEqual(new Date("2026-09-15T23:59:59.999Z"));
  });

  it("rejects reversed dates and oversized pages", () => {
    expect(reportOrderSchema.safeParse({ startDate: "2026-09-15", endDate: "2026-09-01" }).success).toBe(false);
    expect(centralStockReportSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(centralStockTransactionReportSchema.safeParse({ startDate: "2026-09-15", endDate: "2026-09-01" }).success).toBe(false);
  });

  it("supports central-stock inventory and transaction filters", () => {
    const stock = centralStockReportSchema.parse({ status: "inStock", clearanceStatus: "cleared" });
    const transaction = centralStockTransactionReportSchema.parse({ type: "reconcilliationOut" });
    expect(stock).toMatchObject({ page: 1, pageSize: 20, status: "inStock", clearanceStatus: "cleared" });
    expect(transaction).toMatchObject({ page: 1, pageSize: 20, type: "reconcilliationOut" });
  });

  it("defaults an initial report load to the last two days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
    const repository = {
      supplyChainOrderSummary: vi.fn().mockResolvedValue({}),
      supplyChainOrderDetails: vi.fn().mockResolvedValue({}),
    };
    const service = new ReportService({} as never);
    (service as unknown as { repository: typeof repository }).repository = repository;

    await service.getOrderReportDetails(reportOrderSchema.parse({}));

    expect(repository.supplyChainOrderSummary).toHaveBeenCalledWith(expect.objectContaining({
      startDate: new Date("2026-09-14T12:00:00.000Z"),
      endDate: new Date("2026-09-16T12:00:00.000Z"),
    }));
    expect(repository.supplyChainOrderDetails).toHaveBeenCalledWith(expect.objectContaining({
      startDate: new Date("2026-09-14T12:00:00.000Z"),
      endDate: new Date("2026-09-16T12:00:00.000Z"),
    }));
  });
});
