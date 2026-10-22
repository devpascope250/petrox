import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, pagedDatesQuerySchema, parseInput } from "../../shared/validation/index.js";
import { PfiService } from "./pfi.service.js";
import { PfiRepository } from "./pfi.repository.js";
import { createCurrancySchema, createPfiSchema } from "./pfi.schema.js";
import { parsePfiMultipart } from "./pfi-upload.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new PfiService(new PfiRepository(app.prisma), app.config);
  app.get(
    "/",
    { preHandler: [app.authenticate, app.authorize("pfi.read", "pfi.manage")] },
    async (request) => success(await service.list(parseInput(pagedDatesQuerySchema, request.query))),
  );
  app.get(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("pfi.read", "pfi.manage")] },
    async (request) =>
      success(
        await service.find(parseInput(idParamsSchema, request.params).id),
      ),
  );
  app.post(
    "/",
    {
      preHandler: [app.authenticate, app.authorize("pfi.create", "pfi.manage")],
    },
    async (request, reply) => {
      const body = request.isMultipart()
        ? await parsePfiMultipart(request)
        : request.body;
      return created(
        reply,
        await service.create(parseInput(createPfiSchema, {...(body) as object, createdBy: request.contextUser?.userId})),
      );
    },
  );
  app.put(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("pfi.edit", "pfi.manage")] },
    async (request, reply) => {
      const body = request.isMultipart()
        ? await parsePfiMultipart(request)
        : request.body;
      return created(
        reply,
        await service.update(
          parseInput(idParamsSchema, request.params).id,
          parseInput(createPfiSchema, body),
        ),
      );
    },
  );

  app.get(
    "/currency",
    { preHandler: [app.authenticate, app.authorize("pfi.read", "pfi.manage")] },
    async (request) => success(await service.listCurrency()),
  );

  app.post(
    "/currency",
    {
      preHandler: [app.authenticate, app.authorize("pfi.create", "pfi.manage")],
    },
    async (request, reply) =>
      created(
        reply,
        await service.createCurrency(
          parseInput(createCurrancySchema, request.body),
        ),
      ),
  );
  app.put(
    "/currency/:id",
    { preHandler: [app.authenticate, app.authorize("pfi.edit", "pfi.manage")] },
    async (request, reply) =>
      created(
        reply,
        await service.updateCurrency(
          parseInput(idParamsSchema, request.params).id,
          parseInput(createCurrancySchema, request.body),
        ),
      ),
  );
};

export default routes;
