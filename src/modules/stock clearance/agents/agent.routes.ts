import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../../shared/validation/index.js";
import { ClearanceAgentService } from "./agent.service.js";
import { ClearanceAgentRepository } from "./agent.repository.js";
import { createClearingAgentSchema } from "./agent.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new ClearanceAgentService(new ClearanceAgentRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("clearance.agent.read", "clearance.agent.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("clearance.agent.read", "clearance.agent.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("clearance.agent.create", "clearance.agent.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createClearingAgentSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("clearance.agent.edit", "clearance.agent.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createClearingAgentSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("clearance.agent.edit", "clearance.agent.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;