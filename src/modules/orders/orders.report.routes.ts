import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ReportService } from "../../reports/report.service.js";
import { centralStockInventorySchema, centralStockReportSchema, centralStockTransactionReportSchema, reportOrderSchema } from "../../reports/report.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new ReportService(app.prisma);
  app.get("/order-details", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportDetails(valid))
  });


  app.get("/order-report/by-supplier", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportBySupplyer(valid))
  });


   app.get("/order-report/by-item", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportByItems(valid))
  });

  app.get("/order-report/by-order-id/:id", {preHandler: [app.authenticate, app.authorize("orders.read")]}, async (request) => {
    const paramId = parseInput(idParamsSchema, request.params).id;
    return success(await service.getOrderReportRepository(paramId));
  });

   app.get("/order-report/by-deport", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportByDeport(valid))
  });

  app.get("/order-report/by-order-plan", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportByOrderPlan(valid))
  });

  app.get("/order-report/by-tolerance", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(reportOrderSchema, request.query);
    return success(await service.getOrderReportByTolerance(valid))
  });

  app.get("/central-stock", { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] }, async (request) => {
    const valid = parseInput(centralStockReportSchema, request.query);
    return success(await service.getCentralStockReport(valid));
  });

  app.get("/central-stock/inventory", { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] }, async (request) => {
    const valid = parseInput(centralStockInventorySchema, request.query);
    return success(await service.getCentralStockInventory(valid));
  });

  app.get("/central-stock/transactions", { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] }, async (request) => {
    const valid = parseInput(centralStockTransactionReportSchema, request.query);
    return success(await service.getCentralStockTransactions(valid));
  });
};

export default routes;
