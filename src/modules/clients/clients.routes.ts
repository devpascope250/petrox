import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { ClientRepository } from "./clients.repository.js";
import {
  createClientUserSchema,
  updateOrganizationSchema,
  updateUserSchema
} from "./clients.schema.js";
import { ClientService } from "./clients.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ClientService(new ClientRepository(app.prisma), app.config);

  app.get("/", { preHandler: [app.authenticate, app.authorize("clients.read")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query), request.contextUser!)));

  app.get("/organizations", { preHandler: [app.authenticate, app.authorize("clients.read")] }, async (request) =>
    success(await service.organizations(parseInput(paginationQuerySchema, request.query), request.contextUser!)));

  app.put("/organizations/:id", { preHandler: [app.authenticate, app.authorize("clients.edit")] }, async (request) =>
    success(await service.updateOrganization(
      parseInput(idParamsSchema, request.params).id,
      parseInput(updateOrganizationSchema, request.body),
      request.contextUser!
    )));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("clients.read")] }, async (request) =>
    success(await service.get(parseInput(idParamsSchema, request.params).id, request.contextUser!)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("clients.create")] }, async (request, reply) =>
    created(reply, await service.create(
      parseInput(createClientUserSchema, request.body),
      request.contextUser!
    )));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("clients.edit")] }, async (request) =>
    success(await service.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(updateUserSchema, request.body),
      request.contextUser!
    )));

  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("clients.edit")] }, async (request) =>
    success(await service.changeStatus(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!
    )));

  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("clients.delete")] }, async (request) =>
    success(await service.delete(
      parseInput(idParamsSchema, request.params).id,
      request.contextUser!
    )));
};

export default routes;
