import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { SupplierService } from "./supplier.service.js";
import { SupplerRepository } from "./orders.repository.js";
import { createSupplierSchema, createSupplierTypeSchema } from "./supplier.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new SupplierService(new SupplerRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("suppliers.read", "suppliers.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("suppliers.read", "suppliers.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("suppliers.create", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createSupplierSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("suppliers.edit", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createSupplierSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("suppliers.edit", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.updateSupplierStatus(parseInput(idParamsSchema, request.params).id)));

    app.get("/supplier-type", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      success(await service.listSupplierType()));

    app.get("/supplier-type/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      success(await service.findSupplierType(parseInput(idParamsSchema, request.params).id)));

     app.post("/supplier-type", { preHandler: [app.authenticate, app.authorize("suppliers.type.create", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply,await service.createSupplierType(parseInput(createSupplierTypeSchema, request.body))));

     app.put("/supplier-type/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply, await service.updateSupplierType(parseInput(idParamsSchema, request.params).id, parseInput(createSupplierTypeSchema, request.body))));

     app.put("/supplier-type/status/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply, await service.updateSupplierTypeStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;