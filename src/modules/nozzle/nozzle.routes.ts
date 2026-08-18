import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { NozzleRepository } from "./nozzle.repository.js";
import { NozzleService } from "./nozzle.service.js";
import { createNozzleSchema } from "./nozzle.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new NozzleService(new NozzleRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("nozzle.create", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createNozzleSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("nozzle.edit", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createNozzleSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("nozzle.edit", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;