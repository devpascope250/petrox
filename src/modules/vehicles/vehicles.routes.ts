import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { VehiclesService } from "./vehicles.service.js";
import { VehicleRepository } from "./vehicles.repository.js";
import { createVehicleSchema } from "./vehicles.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new VehiclesService(new VehicleRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("vehicles.read", "vehicles.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("vehicles.read", "vehicles.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("vehicles.create", "vehicles.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createVehicleSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("vehicles.edit", "vehicles.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createVehicleSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("transporters.edit", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;