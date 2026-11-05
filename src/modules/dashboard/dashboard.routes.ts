import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { DashboardRepository } from "./dashboard.repository.js";
import { dashboardQuerySchema } from "./dashboard.schema.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * `GET /dashboard/summary` — the home page's figures. Open to anyone signed
 * in; the service decides what they see: every site for a super
 * administrator, their own site for site staff, nothing for anyone else.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new DashboardService(new DashboardRepository(app.prisma));

  app.get("/summary", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.summary(parseInput(dashboardQuerySchema, request.query), request.contextUser!)));

  /*
   * `GET /dashboard/supply-chain` — ordering through to clearance, company
   * wide. Open to whoever may already see any part of it: these are the same
   * figures their own screens show, only added up.
   */
  app.get("/supply-chain", {
    preHandler: [
      app.authenticate,
      app.authorize(
        "orders.read", "orders.manage",
        "cargo.read", "cargo.manage",
        "central.stock.read", "central.stock.manage",
        "order.report.read", "central.stock.report.read",
      ),
    ],
  }, async (request) =>
    success(await service.supplyChain(parseInput(dashboardQuerySchema, request.query))));
};

export default routes;
