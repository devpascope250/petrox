import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { OperationsReportService } from "../../reports/operations/operations-report.service.js";
import { depotStockMovementReportSchema, procurementOrderReportSchema } from "../../reports/operations/operations-report.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new OperationsReportService(app.prisma);

  app.get("/procurement-orders", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(procurementOrderReportSchema, request.query);
    return success(await service.getProcurementOrders(valid));
  });

  app.get("/depot-stock-movement", { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] }, async (request) => {
    const valid = parseInput(depotStockMovementReportSchema, request.query);
    return success(await service.getDepotStockMovement(valid));
  });
};

export default routes;
