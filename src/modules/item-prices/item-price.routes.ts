import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ItemPriceService } from "./item-price.service.js";
import { ItemPriceRepository } from "./item-price.repository.js";
import { createItemPriceSchema, updateItemPriceSchema } from "./item-price.schema.js";

/**
 * What each item sells for, per unit. There is no delete: a price is switched
 * off instead (`PUT /status/:id`), so past prices stay on record.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new ItemPriceService(new ItemPriceRepository(app.prisma));

  app.get("/options", { preHandler: [app.authenticate, app.authorize("item.price.create", "item.price.edit")] }, async () =>
    success(await service.options()));
  app.get("/", { preHandler: [app.authenticate, app.authorize("item.price.read")] }, async () =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("item.price.read")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("item.price.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createItemPriceSchema, request.body), request.contextUser!.userId)));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("item.price.edit")] }, async (request) =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateItemPriceSchema, request.body))));
  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("item.price.edit")] }, async (request) =>
    success(await service.changeStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
