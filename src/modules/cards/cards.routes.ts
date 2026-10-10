import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { CardsRepository } from "./cards.repository.js";
import {
  addCopyCardsSchema,
  assignCardsSchema,
  assignCopyCardSchema,
  cardClientParamsSchema,
  cardClientQuerySchema,
  bindSerialNumberSchema,
  cardCopyListQuerySchema,
  cardListQuerySchema,
  cardParamsSchema,
  cardTransactionQuerySchema,
  createCardCopySchema,
  createCardSchema,
  serialNumberLookupSchema,
  setCardPinSchema,
  updateCardCopySchema,
  updateCardSchema
} from "./cards.schema.js";
import { CardsService } from "./cards.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CardsService(new CardsRepository(app.prisma, app.config.PIN_HMAC_SECRET));

  app.get("/", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.listCards(parseInput(cardListQuerySchema, request.query), request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.findCard(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("cards.create")] }, async (request, reply) =>
    created(reply, await service.createCard(parseInput(createCardSchema, request.body))));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("cards.edit")] }, async (request) =>
    success(await service.updateCard(parseInput(cardParamsSchema, request.params).id, parseInput(updateCardSchema, request.body), request.contextUser!)));
  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("cards.delete")] }, async (request) =>
    success(await service.deleteCard(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));

  // Static paths are declared before "/:id" reads them as an id.
  app.get("/by-serial-number", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.findCardBySerialNumber(parseInput(serialNumberLookupSchema, request.query).serialNumber, request.contextUser!)));
  app.get("/:id/transactions", { preHandler: [app.authenticate, app.authorize("cards.read")] }, async (request) =>
    success(await service.listTransactions(parseInput(cardParamsSchema, request.params).id, parseInput(cardTransactionQuerySchema, request.query), request.contextUser!)));
  app.patch("/:id/serial-number", { preHandler: [app.authenticate, app.authorize("cards.edit")] }, async (request) =>
    success(await service.bindSerialNumber(parseInput(cardParamsSchema, request.params).id, parseInput(bindSerialNumberSchema, request.body), request.contextUser!)));
  app.delete("/:id/serial-number", { preHandler: [app.authenticate, app.authorize("cards.edit")] }, async (request) =>
    success(await service.unbindSerialNumber(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));

  // The card-management flow: find a client, hand them cards, see what they hold.
  app.get("/clients", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.searchClients(parseInput(cardClientQuerySchema, request.query), request.contextUser!)));
  app.get("/clients/:clientId/cards", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.clientCards(parseInput(cardClientParamsSchema, request.params).clientId, request.contextUser!)));
  app.post("/assignments", { preHandler: [app.authenticate, app.authorize("cards.copy.create")] }, async (request, reply) =>
    created(reply, await service.assignCards(parseInput(assignCardsSchema, request.body), request.contextUser!)));

  app.get("/copies", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.listCopies(parseInput(cardCopyListQuerySchema, request.query), request.contextUser!)));
  app.get("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.read")] }, async (request) =>
    success(await service.findCopy(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.post("/copies", { preHandler: [app.authenticate, app.authorize("cards.copy.create")] }, async (request, reply) =>
    created(reply, await service.createCopy(parseInput(createCardCopySchema, request.body), request.contextUser!)));
  app.put("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.updateCopy(parseInput(cardParamsSchema, request.params).id, parseInput(updateCardCopySchema, request.body), request.contextUser!)));
  app.patch("/copies/:id/copy-card", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.assignCopyCard(parseInput(cardParamsSchema, request.params).id, parseInput(assignCopyCardSchema, request.body).cardCopyId, request.contextUser!)));
  app.post("/copies/:id/copy-cards", { preHandler: [app.authenticate, app.authorize("cards.copy.create")] }, async (request, reply) =>
    created(reply, await service.addCopyCards(parseInput(cardParamsSchema, request.params).id, parseInput(addCopyCardsSchema, request.body).cardCopyIds, request.contextUser!)));
  // A card's PIN: set a new one, or put it back to the default. Never read back.
  app.put("/copies/:id/pin", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.setPin(parseInput(cardParamsSchema, request.params).id, parseInput(setCardPinSchema, request.body).pin, request.contextUser!)));
  app.post("/copies/:id/pin/reset", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.setPin(parseInput(cardParamsSchema, request.params).id, undefined, request.contextUser!)));
  app.patch("/copies/:id/status", { preHandler: [app.authenticate, app.authorize("cards.copy.edit")] }, async (request) =>
    success(await service.changeCopyStatus(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
  app.delete("/copies/:id", { preHandler: [app.authenticate, app.authorize("cards.copy.delete")] }, async (request) =>
    success(await service.deleteCopy(parseInput(cardParamsSchema, request.params).id, request.contextUser!)));
};

export default routes;
