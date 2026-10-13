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
};

export default routes;
