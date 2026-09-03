import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { assignDriverVehicleParams, idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { DriverService } from "./driver.service.js";
import { DriverRepository } from "./driver.repository.js";
import { createDriverSchema } from "./deriver.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new DriverService(new DriverRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("drivers.read", "drivers.manage")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query))));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("drivers.read", "drivers.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("drivers.create", "drivers.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createDriverSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("drivers.edit", "drivers.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createDriverSchema, request.body))));

  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("drivers.edit", "drivers.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

  app.put("/assign/:vehicleId/:driverId", { preHandler: [app.authenticate, app.authorize("drivers.edit", "drivers.manage")] }, async (request, reply) =>
    created(reply, await service.assignVehicle(parseInput(assignDriverVehicleParams, request.params).vehicleId, parseInput(assignDriverVehicleParams, request.params).driverId)));

};

export default routes;
