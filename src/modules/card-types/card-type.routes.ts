import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CardTypeService } from "./card-type.service.js";
import { CardTypeRepository } from "./card-type.repository.js";
import { createCardTypeSchema, updateCardTypeSchema } from "./card-type.schema.js";

/**
 * Kinds of card, each with its settings (PIN, plate number, limits…). There is
 * no delete: a type is switched off instead (`PUT /status/:id`).
 *
 * Reading is open to anyone who works with cards, since the card forms list
 * the types to choose from.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new CardTypeService(new CardTypeRepository(app.prisma));
  const read = app.authorize("card.types.read", "cards.read", "cards.copy.read");

  app.get("/", { preHandler: [app.authenticate, read] }, async () => success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("card.types.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createCardTypeSchema, request.body), request.contextUser!.userId)));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("card.types.edit")] }, async (request) =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateCardTypeSchema, request.body))));
  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("card.types.edit")] }, async (request) =>
    success(await service.changeStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
