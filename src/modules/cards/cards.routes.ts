import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { CardsRepository } from "./cards.repository.js";
import {
  assignCopyCardSchema,
  cardParamsSchema,
  createCardCopySchema,
  createCardSchema,
  updateCardCopySchema,
  updateCardSchema
} from "./cards.schema.js";
import { CardsService } from "./cards.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CardsService(new CardsRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.listCards(parseInput(paginationQuerySchema, request.query), request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.findCard(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("cards.create")] }, async (request, reply) =>
    created(reply, await service.createCard(parseInput(createCardSchema, request.body))));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("cards.edit")] }, async (request) =>
    success(await service.updateCard(parseInput(cardParamsSchema, request.params).id, parseInput(updateCardSchema, request.body), request.contextUser!)));
  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("cards.delete")] }, async (request) =>
    success(await service.deleteCard(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));

  app.get("/copies", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.listCopies(parseInput(paginationQuerySchema, request.query), request.contextUser!)));
  app.get("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.findCopy(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.post("/copies", { preHandler: [app.authenticate, app.authorize("cards.copy.create")] }, async (request, reply) =>
    created(reply, await service.createCopy(parseInput(createCardCopySchema, request.body), request.contextUser!)));
  app.put("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.updateCopy(parseInput(cardParamsSchema, request.params).id, parseInput(updateCardCopySchema, request.body), request.contextUser!)));
  app.patch("/copies/:id/copy-card", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.assignCopyCard(parseInput(cardParamsSchema, request.params).id, parseInput(assignCopyCardSchema, request.body).cardCopyId, request.contextUser!)));
  app.patch("/copies/:id/status", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.changeCopyStatus(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.delete("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.delete")] }, async (request) =>
    success(await service.deleteCopy(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
};

export default routes;
