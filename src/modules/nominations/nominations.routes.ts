import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  idParamsSchema,
  parseInput,
} from "../../shared/validation/index.js";
import { NominationService } from "./nominations.service.js";
import { NominationRepository } from "./nominations.repository.js";
import {
  addNominationVesselSchema,
  createNominationsSchema,
  nominationListQuerySchema,
} from "./nominations.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new NominationService(
    new NominationRepository(app.prisma),
    app.config,
  );
  app.get(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.read", "nominations.manage"),
      ],
    },
    async (request) =>
      success(await service.list(parseInput(nominationListQuerySchema, request.query))),
  );

  app.get(
    "/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.read", "nominations.manage"),
      ],
    },
    async (request) =>
      success(
        await service.find(parseInput(idParamsSchema, request.params).id),
      ),
  );
  app.get(
    "/time-line/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.read", "nominations.manage"),
      ],
    },
    async (request) =>
      success(
        await service.findTimeLine(
          parseInput(idParamsSchema, request.params).id,
        ),
      ),
  );
  app.post(
    "/",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.create", "nominations.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.create(
          parseInput(createNominationsSchema, {
            ...(request.body as object),
            createdBy: request.contextUser?.userId,
          }),
        ),
      ),
  );
  app.post(
    "/:id/vessels",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.edit", "nominations.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.addVessels(
          parseInput(idParamsSchema, request.params).id,
          parseInput(addNominationVesselSchema, request.body),
        ),
      ),
  );
  app.put(
    "/:id",
    {
      preHandler: [
        app.authenticate,
        app.authorize("nominations.edit", "nominations.manage"),
      ],
    },
    async (request, reply) =>
      created(
        reply,
        await service.update(
          parseInput(idParamsSchema, request.params).id,
          parseInput(createNominationsSchema, request.body),
        ),
      ),
  );
};

export default routes;
