import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CuveService } from "./cuve.service.js";
import { CuveRepository } from "./cuve.repository.js";
import { createCuveSchema, cuveInventoryQuerySchema, cuveStockQuerySchema, cuveTransactionsQuerySchema } from "./cuve.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new CuveService(new CuveRepository(app.prisma), app.config);
  // Stock levels belong to the "Cuve Stock" module; `cuve.read` keeps working for the reports.
  // Selling out of a cuve is its own module — see /fuel-sales.
  app.get("/stocks", { preHandler: [app.authenticate, app.authorize("cuve.stock.read", "cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.stocks(parseInput(cuveStockQuerySchema, request.query), request.contextUser!)));
  app.get("/inventory", { preHandler: [app.authenticate, app.authorize("cuve.stock.read", "cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.inventory(parseInput(cuveInventoryQuerySchema, request.query), request.contextUser!)));
  app.get("/:id/transactions", { preHandler: [app.authenticate, app.authorize("cuve.stock.read", "cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.transactions(
      parseInput(idParamsSchema, request.params).id,
      parseInput(cuveTransactionsQuerySchema, request.query),
      request.contextUser!,
    )));
  app.get("/", { preHandler: [app.authenticate, app.authorize("cuve.read", "cuve.manage")] }, async (request) =>
    success(await service.list(request.contextUser!)));
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
