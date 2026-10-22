import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput, planStatusParamsSchema, querySearchOrderSupplierPlanSchema } from "../../shared/validation/index.js";
import { OrderService } from "./orders.service.js";
import { OrderRepository } from "./orders.repository.js";
import { createOrderPlanSchema, CreateOrderSchema, createOrderSchema, orderListQuerySchema } from "./orders.schema.js";
import { NotFoundError, unauthorized } from "../../utils/errors.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new OrderService(new OrderRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) =>
    success(await service.list(parseInput(orderListQuerySchema, request.query))));
  app.get("/by-supplier-or-plan", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) => {
    const valid = parseInput(querySearchOrderSupplierPlanSchema, request.query);
    if (!valid.planId && !valid.supplierId) throw new NotFoundError();
    return success(await service.listByPlanOrSupplier(valid.supplierId, valid.planId));
  }
    );
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("orders.read", "orders.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("orders.create", "orders.manage")] }, async (request, reply) => {
    if (!request.contextUser?.userId) throw unauthorized();
   return created(reply, await service.create(parseInput(createOrderSchema, request.body), request.contextUser?.userId))
  })

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("orders.edit", "orders.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createOrderSchema, request.body))));

    app.get("/order-plan", { preHandler: [app.authenticate, app.authorize("orders.plan.read", "orders.plan.manage")] }, async (request, reply) =>
      success(await service.listOrderPlan()));

    app.get("/order-plan/:id", { preHandler: [app.authenticate, app.authorize("orders.plan.read", "orders.plan.manage")] }, async (request, reply) =>
      success(await service.findOrderPlan(parseInput(idParamsSchema, request.params).id)));

     app.post("/order-plan", { preHandler: [app.authenticate, app.authorize("orders.plan.create", "orders.plan.manage")] }, async (request, reply) =>
      created(reply,await service.createOrderPlan(parseInput(createOrderPlanSchema, request.body))));

     app.put("/order-plan/:id", { preHandler: [app.authenticate, app.authorize("orders.plan.read", "orders.plan.manage")] }, async (request, reply) =>
      created(reply, await service.updateOrderPlan(parseInput(idParamsSchema, request.params).id, parseInput(createOrderPlanSchema, request.body))));

     app.put("/order-plan/status/:id/:status", { preHandler: [app.authenticate, app.authorize("orders.plan.read", "orders.plan.manage")] }, async (request, reply) =>
      created(reply, await service.updateSupplierTypeStatus(parseInput(idParamsSchema, request.params).id, parseInput(planStatusParamsSchema, request.params).status)))

};

export default routes;