import type { FastifyPluginAsync } from "fastify";
import { startExpirySweep } from "./expiry-sweep.js";
import { created, success } from "../../shared/http/index.js";
import { paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { DiscountRepository } from "./discount.repository.js";
import { createDiscountSchema, discountParamsSchema, updateDiscountSchema } from "./discount.schema.js";
import { DiscountService } from "./discount.service.js";

const routes: FastifyPluginAsync = async (app) => {
  // Discounts and subsidies whose last day has passed are retired, so the
  // screens stop calling a finished rate active. Registered here because the
  // discounts module is the first of the two to load; it sweeps both.
  if (app.config.NODE_ENV !== "test") startExpirySweep(app);

  const service = new DiscountService(new DiscountRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("discounts.read")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query), request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("discounts.read")] }, async (request) =>
    success(await service.find(parseInput(discountParamsSchema, request.params).id, request.contextUser!)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("discounts.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createDiscountSchema, request.body), request.contextUser!)));
  app.put("/:id", { preHandler: [app.authenticate, app.authorize("discounts.edit")] }, async (request) =>
    success(await service.update(parseInput(discountParamsSchema, request.params).id, parseInput(updateDiscountSchema, request.body), request.contextUser!)));
  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("discounts.edit")] }, async (request) =>
    success(await service.changeStatus(parseInput(discountParamsSchema, request.params).id, request.contextUser!)));
  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("discounts.delete")] }, async (request) =>
    success(await service.delete(parseInput(discountParamsSchema, request.params).id, request.contextUser!)));
};

export default routes;
