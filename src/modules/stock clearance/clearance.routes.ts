import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { createStockClearanceSchema } from "./clearance.schema.js";
import { StockClearanceService } from "./clearance.service.js";
import { StockClearanceRepository } from "./clearance.repository.js";
import { parseClearanceMultipart } from "./clearance-upload.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new StockClearanceService(new StockClearanceRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("stock.clearance.read", "stock.clearance.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("stock.clearance.read", "stock.clearance.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("stock.clearance.create", "stock.clearance.manage")] }, async (request, reply) => {
    const fields = await parseClearanceMultipart(request);
    return created(reply, await service.create(parseInput(createStockClearanceSchema, {
      ...fields, clearedBy: request.contextUser?.userId,
    })));
  });
};

export default routes;
