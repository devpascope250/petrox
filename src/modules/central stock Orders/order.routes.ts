import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CentralStockOrderService } from "./order.service.js";
import { CentralStockOrderRepository } from "./order.repository.js";
import { createCentralStockOrderSchema } from "./order.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new CentralStockOrderService(new CentralStockOrderRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("stockout.orders.read", "stockout.orders.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("stockout.orders.create", "stockout.orders.manage")] }, async (request, reply) => {
    const userId = request.contextUser?.userId;
    const payload = {
      ...(request.body as object),
      createdBy: userId

    }
    return created(reply, await service.create(parseInput(createCentralStockOrderSchema, payload)))
  }
    );
};

export default routes;