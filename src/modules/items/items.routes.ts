import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { ItemsService } from "./items.service.js";
import { ItemsRepository } from "./items.repository.js";
import { createItemSchema, createUnitSchema } from "./items.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ItemsService(new ItemsRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("items.create", "items.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createItemSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("items.edit", "items.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createItemSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("items.edit", "items.manage")] }, async (request, reply) =>
    created(reply, await service.updateItemStatus(parseInput(idParamsSchema, request.params).id)));

    app.get("/units", { preHandler: [app.authenticate, app.authorize("units.read", "units.manage")] }, async (request, reply) =>
      success(await service.listUnits()));

    app.get("/units/:id", { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] }, async (request, reply) =>
      success(await service.findUnit(parseInput(idParamsSchema, request.params).id)));

     app.post("/units", { preHandler: [app.authenticate, app.authorize("units.create", "units.manage")] }, async (request, reply) =>
      created(reply,await service.createUnit(parseInput(createUnitSchema, request.body))));

     app.put("/units/:id", { preHandler: [app.authenticate, app.authorize("units.read", "units.manage")] }, async (request, reply) =>
      created(reply, await service.updateUnit(parseInput(idParamsSchema, request.params).id, parseInput(createUnitSchema, request.body))));

     app.put("/units/status/:id", { preHandler: [app.authenticate, app.authorize("units.read", "units.manage")] }, async (request, reply) =>
      created(reply, await service.updateUnitStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;