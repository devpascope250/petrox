import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { UsersRepository } from "./users.repository.js";
import {
  assignUserSiteSchema,
  createClientUserSchema,
  createUserSchema,
  updateUserSchema
} from "./users.schema.js";
import { UsersService } from "./users.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new UsersService(new UsersRepository(app.prisma), app.config);

  app.get("/", { preHandler: [app.authenticate, app.authorize("users.read")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query))));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("users.read")] }, async (request) =>
    success(await service.get(parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  // Everything a create-user form needs to build its position select and the
  // dependent site / client selects, scoped to what this actor may create.
  app.get("/form-options", { preHandler: [app.authenticate, app.authorize("users.create")] }, async (request) =>
    success(await service.formOptions(request.contextUser!)));

  // Accepts any position. Who may actually create what is enforced in the
  // service, not by the schema, so this stays as strict as the split routes.
  app.post("/", { preHandler: [app.authenticate, app.authorize("users.create")] }, async (request, reply) =>
    created(reply, await service.create(
      parseInput(createUserSchema, request.body),
      request.contextUser!
    )));

  app.post("/create/client", { preHandler: [app.authenticate, app.authorize("users.create")] }, async (request, reply) =>
    created(reply, await service.create(
      parseInput(createClientUserSchema, request.body),
      request.contextUser!
    )));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("users.edit")] }, async (request) =>
    success(await service.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(updateUserSchema, request.body),
      request.contextUser!
    )));

  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("users.edit")] }, async (request) =>
    success(await service.changeStatus(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!
    )));

  app.patch("/:id/site", { preHandler: [app.authenticate, app.authorize("users.edit")] }, async (request) =>
    success(await service.assignSite(
      parseInput(idParamsSchema, request.params).id,
      parseInput(assignUserSiteSchema, request.body).siteId,
      request.contextUser!
    )));

  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("users.delete")] }, async (request) =>
    success(await service.delete(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!
    )));
};

export default routes;
