import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { TransporterService } from "./transporter.js";
import { TransporterRepository } from "./transporter.repository.js";
import { createTransporterSchema } from "./transporter.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new TransporterService(new TransporterRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("transporters.read", "transporters.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("transporters.read", "transporters.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("transporters.create", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createTransporterSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("transporters.edit", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createTransporterSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("transporters.edit", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;