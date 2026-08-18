import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { createPumpSchema } from "./pump.schema.js";
import { PumpService } from "./pump.service.js";
import { PumpRepository } from "./pump.repository.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new PumpService(new PumpRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("pump.read", "pump.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("pump.read", "pump.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("pump.create", "pump.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createPumpSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("pump.edit", "pump.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createPumpSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("pump.edit", "pump.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;