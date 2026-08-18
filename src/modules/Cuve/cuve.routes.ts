import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CuveService } from "./cuve.service.js";
import { CuveRepository } from "./cuve.repository.js";
import { createCuveSchema } from "./cuve.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new CuveService(new CuveRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("cuve.create", "cuve.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createCuveSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("cuve.edit", "cuve.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createCuveSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("cuve.edit", "cuve.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;