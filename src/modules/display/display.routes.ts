import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { DisplayService } from "./display.service.js";
import { DisplayRepository } from "./display.repository.js";
import { createDisplaySchema } from "./display.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new DisplayService(new DisplayRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("display.read", "display.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("display.read", "display.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("display.create", "display.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createDisplaySchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("display.edit", "display.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createDisplaySchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("display.edit", "display.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;