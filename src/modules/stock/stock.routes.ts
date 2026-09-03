import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput, stockStatusPamasSchema } from "../../shared/validation/index.js";
import { StockRepository } from "./stock.repository.js";
import { StockService } from "./stock.service.js";
import { createStockSchema, stockReportQuerySchema } from "./stock.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new StockService(new StockRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("stock.read", "stock.manage")] }, async (request) =>
    success(await service.list(parseInput(stockReportQuerySchema, request.query))));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("stock.read", "stock.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  // app.post("/", { preHandler: [app.authenticate, app.authorize("stock.create", "stock.manage")] }, async (request, reply) =>
  //   created(reply, await service.create(parseInput(createStockSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("stock.edit", "stock.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createStockSchema, request.body))));
  app.put("/status/:id/:status", { preHandler: [app.authenticate, app.authorize("stock.edit", "stock.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id, parseInput(stockStatusPamasSchema, request.params).status)));
};

export default routes;
