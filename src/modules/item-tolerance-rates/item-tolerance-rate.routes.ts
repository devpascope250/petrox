import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ItemToleranceRateRepository } from "./item-tolerance-rate.repository.js";
import {
  createItemToleranceRateSchema,
  updateItemToleranceRateSchema,
} from "./item-tolerance-rate.schema.js";
import { ItemToleranceRateService } from "./item-tolerance-rate.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ItemToleranceRateService(new ItemToleranceRateRepository(app.prisma));

  app.get(
    "/",
    { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] },
    async () => success(await service.list()),
  );

  app.get(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] },
    async (request) =>
      success(await service.find(parseInput(idParamsSchema, request.params).id)),
  );

  app.post(
    "/",
    { preHandler: [app.authenticate, app.authorize("items.create", "items.manage")] },
    async (request, reply) =>
      created(
        reply,
        await service.create(parseInput(createItemToleranceRateSchema, request.body)),
      ),
  );

  app.put(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("items.edit", "items.manage")] },
    async (request) =>
      success(
        await service.update(
          parseInput(idParamsSchema, request.params).id,
          parseInput(updateItemToleranceRateSchema, request.body),
        ),
      ),
  );

  app.patch(
    "/:id/status",
    { preHandler: [app.authenticate, app.authorize("items.edit", "items.manage")] },
    async (request) =>
      success(await service.changeStatus(parseInput(idParamsSchema, request.params).id)),
  );

  app.get(
    "/item/:itemId",
    { preHandler: [app.authenticate, app.authorize("items.read", "items.manage")] },
    async (request) =>
      success(
        await service.getItemToleranceRateByItemId(
          parseInput(idParamsSchema, request.params).id,
        ),
      ),
  );

};

export default routes;
