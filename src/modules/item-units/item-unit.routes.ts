import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ItemUnitService } from "./item-unit.service.js";
import { ItemUnitRepository } from "./item-unit.repository.js";
import { createItemUnitSchema, updateItemUnitSchema } from "./item-unit.schema.js";

/**
 * The units each item is measured and priced in. There is no delete: a unit
 * is switched off instead (`PUT /status/:id`), so its prices stay on record.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new ItemUnitService(new ItemUnitRepository(app.prisma));

  app.get("/options", { preHandler: [app.authenticate, app.authorize("item.units.create", "item.units.edit")] }, async () =>
    success(await service.options()));
  app.get("/", { preHandler: [app.authenticate, app.authorize("item.units.read")] }, async () =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("item.units.read")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("item.units.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createItemUnitSchema, request.body))));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("item.units.edit")] }, async (request) =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateItemUnitSchema, request.body))));
  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("item.units.edit")] }, async (request) =>
    success(await service.changeStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
