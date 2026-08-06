import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { UsersRepository } from "./users.repository.js";
import { createUserSchema } from "./users.schema.js";
import { UsersService } from "./users.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new UsersService(new UsersRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("users.read")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query))));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("users.read")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("users.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createUserSchema, request.body))));
};

export default routes;