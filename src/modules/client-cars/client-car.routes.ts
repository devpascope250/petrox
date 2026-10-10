import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ClientCarRepository } from "./client-car.repository.js";
import { ClientCarService } from "./client-car.service.js";
import {
  assignCardsSchema, carCardParamsSchema, clientCarListQuerySchema, clientParamsSchema, clientSearchSchema, createClientCarSchema, updateClientCarSchema,
} from "./client-car.schema.js";

/**
 * A client's cars and the cards each one carries — a car can carry several
 * cards, and a card can serve several cars. Guarded by the "Client Cars"
 * module (`client.cars.*`). There is no delete: a car is switched off
 * (`PATCH /:id/status`), which also takes its cards off it.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new ClientCarService(new ClientCarRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("client.cars.read")] }, async (request) =>
    success(await service.list(parseInput(clientCarListQuerySchema, request.query), request.contextUser!)));
  app.get("/items", { preHandler: [app.authenticate, app.authorize("client.cars.read")] }, async () =>
    success(await service.items()));
  app.get("/clients", { preHandler: [app.authenticate, app.authorize("client.cars.read")] }, async (request) =>
    success(await service.clients(parseInput(clientSearchSchema, request.query).search, request.contextUser!)));
  app.get("/clients/:clientId/cards", { preHandler: [app.authenticate, app.authorize("client.cars.edit")] }, async (request) =>
    success(await service.clientCards(parseInput(clientParamsSchema, request.params).clientId, request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("client.cars.read")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("client.cars.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createClientCarSchema, request.body), request.contextUser!)));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("client.cars.edit")] }, async (request) =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateClientCarSchema, request.body), request.contextUser!)));
  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("client.cars.edit")] }, async (request) =>
    success(await service.changeStatus(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
  app.post("/:id/cards", { preHandler: [app.authenticate, app.authorize("client.cars.edit")] }, async (request, reply) =>
    created(reply, await service.assignCards(
      parseInput(idParamsSchema, request.params).id, parseInput(assignCardsSchema, request.body).cardCopyIds, request.contextUser!)));
  app.delete("/:id/cards/:cardCopyId", { preHandler: [app.authenticate, app.authorize("client.cars.edit")] }, async (request) => {
    const { id, cardCopyId } = parseInput(carCardParamsSchema, request.params);
    return success(await service.unassignCard(id, cardCopyId, request.contextUser!));
  });
};

export default routes;
