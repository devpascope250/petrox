import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { DeportService } from "./deport.service.js";
import { DeportRepository } from "./deport.repository.js";
import { createDeportSchema } from "./deport.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new DeportService(new DeportRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("deports.read", "deports.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("deports.read", "deports.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("deports.create", "deports.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createDeportSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("deports.edit", "deports.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createDeportSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("deports.edit", "deports.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;