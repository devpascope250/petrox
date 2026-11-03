import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { OperationsReportService } from "../../reports/operations/operations-report.service.js";
import { depotStockMovementReportSchema, procurementOrderReportSchema } from "../../reports/operations/operations-report.schema.js";
import { TransporterToleranceService } from "../../reports/operations/transporter-tolerance.service.js";
import {
  shareToleranceSchema, transporterSharesQuerySchema, transporterToleranceReportSchema,
} from "../../reports/operations/transporter-tolerance.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new OperationsReportService(app.prisma);
  const tolerance = new TransporterToleranceService(app.prisma);

  app.get("/procurement-orders", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(procurementOrderReportSchema, request.query);
    return success(await service.getProcurementOrders(valid));
  });

  app.get("/depot-stock-movement", { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] }, async (request) => {
    const valid = parseInput(depotStockMovementReportSchema, request.query);
    return success(await service.getDepotStockMovement(valid));
  });

  /**
   * What each transporter's trips lost or gained between the border and the
   * depot: the T1's quantity at 20 °C against what was received at 20 °C,
   * judged by the allowance the product carried that day.
   */
  app.get("/transporter-tolerance", {
    preHandler: [app.authenticate, app.authorize("transporter.tolerance.read", "transporter.tolerance.manage")],
  }, async (request) =>
    success(await tolerance.report(parseInput(transporterToleranceReportSchema, request.query))));

  /**
   * Sends a transporter their statement for a period, to the address on their
   * own record — and keeps what was sent. Gated on `manage`: reading what a
   * transporter owes and telling them so are different acts.
   */
  app.post("/transporter-tolerance/share", {
    preHandler: [app.authenticate, app.authorize("transporter.tolerance.manage")],
  }, async (request) =>
    success(await tolerance.share(parseInput(shareToleranceSchema, request.body), request.contextUser!.userId)));

  /** What has been sent, and to whom. */
  app.get("/transporter-tolerance/shares", {
    preHandler: [app.authenticate, app.authorize("transporter.tolerance.read", "transporter.tolerance.manage")],
  }, async (request) =>
    success(await tolerance.shares(parseInput(transporterSharesQuerySchema, request.query).transporterId)));
};

export default routes;
