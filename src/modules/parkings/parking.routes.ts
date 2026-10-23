import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { ParkingRepository } from "./parking.repository.js";
import { createParkingSchema, parkingListQuerySchema } from "./parking.schema.js";
import { ParkingService } from "./parking.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ParkingService(new ParkingRepository(app.prisma));
  const read = { preHandler: [app.authenticate, app.authorize("parkings.read", "parkings.manage")] };

  app.get("/", read, async (request) =>
    success(await service.list(parseInput(parkingListQuerySchema, request.query))));

  /** Every active parking, for the picker that sends a vehicle to one. */
  app.get("/active", read, async () => success(await service.active()));

  app.get("/:id", read, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("parkings.create", "parkings.manage")] },
    async (request, reply) =>
      created(reply, await service.create(parseInput(createParkingSchema, request.body))));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("parkings.edit", "parkings.manage")] },
    async (request) =>
      success(await service.update(
        parseInput(idParamsSchema, request.params).id,
        parseInput(createParkingSchema, request.body),
      )));

  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("parkings.edit", "parkings.manage")] },
    async (request) =>
      success(await service.changeStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
