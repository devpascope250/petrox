import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { unauthorized } from "../../utils/errors.js";
import { VehicleLocationRepository } from "./vehicle-location.repository.js";
import {
  assignVehicleLocationSchema,
  markArrivedSchema,
  vehicleLocationListQuerySchema,
} from "./vehicle-location.schema.js";
import { VehicleLocationService } from "./vehicle-location.service.js";

/**
 * Where vehicles are standing. A parking is recorded against the trip that
 * parked there, so a vehicle can be followed from one parking to the next while
 * it stays in transit — being parked does not end the transit.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new VehicleLocationService(new VehicleLocationRepository(app.prisma));
  const read = {
    preHandler: [app.authenticate, app.authorize("vehicle.locations.read", "vehicle.locations.manage")],
  };

  app.get("/", read, async (request) =>
    success(await service.list(parseInput(vehicleLocationListQuerySchema, request.query))));

  /** What a nomination's drawer shows: where its vehicle is, and where it has been. */
  app.get("/nomination/:id", read, async (request) =>
    success(await service.forNomination(parseInput(idParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("vehicle.locations.create", "vehicle.locations.manage")] },
    async (request, reply) => {
      if (!request.contextUser?.userId) throw unauthorized();
      return created(reply, await service.assign(
        parseInput(assignVehicleLocationSchema, request.body),
        request.contextUser.userId,
      ));
    });

  app.patch("/:id/arrived", { preHandler: [app.authenticate, app.authorize("vehicle.locations.edit", "vehicle.locations.manage")] },
    async (request) =>
      success(await service.markArrived(
        parseInput(idParamsSchema, request.params).id,
        parseInput(markArrivedSchema, request.body ?? {}),
      )));
};

export default routes;
