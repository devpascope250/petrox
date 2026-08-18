import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { createStockClearanceSchema } from "./clearance.schema.js";
import { StockClearanceService } from "./clearance.service.js";
import { StockClearanceRepository } from "./clearance.repository.js";
import { ClearanceAgentRepository } from "./agents/agent.repository.js";
import { ClearanceAgentService } from "./agents/agent.service.js";
import { createClearingAgentSchema } from "./agents/agent.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new StockClearanceService(new StockClearanceRepository(app.prisma), app.config);
  const agentService = new ClearanceAgentService(new ClearanceAgentRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("stock.clearance.read", "stock.clearance.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("stock.clearance.read", "stock.clearance.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("stock.clearance.create", "stock.clearance.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createStockClearanceSchema, request.body))));

  app.post("/clearing-agent", { preHandler: [app.authenticate, app.authorize("stock.clearance.create", "stock.clearance.manage")] }, async (request, reply) =>
    created(reply, await agentService.create(parseInput(createClearingAgentSchema, request.body))));
    app.put("/clearing-agent/:id", { preHandler: [app.authenticate, app.authorize("stock.clearance.edit", "stock.clearance.manage")] }, async (request, reply) =>
    created(reply, await agentService.update(parseInput(idParamsSchema, request.params).id, parseInput(createClearingAgentSchema, request.body))));

     app.put("/clearing-agent/status/:id", { preHandler: [app.authenticate, app.authorize("stock.clearance.edit", "stock.clearance.manage")] }, async (request, reply) =>
    created(reply, await agentService.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;