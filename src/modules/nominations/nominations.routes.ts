import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  datesQuerySchema,
  idParamsSchema,
  itemIdQuerySchema,
  parseInput,
} from "../../shared/validation/index.js";
import { NominationService } from "./nominations.service.js";
import { NominationRepository } from "./nominations.repository.js";
import { createNominationsSchema } from "./nominations.schema.js";
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
      success(
        await service.list(
          parseInput(datesQuerySchema, request.query),
          parseInput(itemIdQuerySchema, request.query).itemId,
        ),
      ),
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
