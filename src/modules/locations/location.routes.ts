import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { LocationRepository } from "./location.repository.js";
import { LocationService } from "./location.service.js";
import {
  createBuikLocationSchema,
  createLocationSchema,
  parentLocationParamsSchema,
} from "./location.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new LocationService(new LocationRepository(app.prisma), app.config);
  const readAccess = [app.authenticate];

  app.get("/", { preHandler: readAccess }, async () => success(await service.list()));

  app.get(
    "/parent/:parentId",
    { preHandler: readAccess },
    async (request) => success(await service.findByParent(
      parseInput(parentLocationParamsSchema, request.params).parentId,
    )),
  );

  app.get(
    "/:id",
    { preHandler: readAccess },
    async (request) => success(await service.find(parseInput(idParamsSchema, request.params).id)),
  );

  app.post(
    "/",
    { preHandler: [app.authenticate ] },
    async (request, reply) => created(reply, await service.create(
      parseInput(createLocationSchema, request.body),
    )),
  );


    app.post(
    "/builk",
    { preHandler: [app.authenticate ] },
    async (request, reply) => created(reply, await service.createBuilk(
      parseInput(createBuikLocationSchema, request.body),
    )),
  );
};

export default routes;
