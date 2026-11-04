import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../../shared/validation/index.js";
import { ClearanceAuthorizerMemberRepository } from "./clearance-authorizer.repository.js";
import { ClearanceAuthorizerMemberService } from "./clearance-authorizer.service.js";
import { clearanceAuthorizerMemberSchema } from "./clearance-authorizer.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ClearanceAuthorizerMemberService(
    new ClearanceAuthorizerMemberRepository(app.prisma));
  const read = [app.authenticate, app.authorize("authorizers.read", "authorizers.manage")];
  const edit = [app.authenticate, app.authorize("authorizers.edit", "authorizers.manage")];

  app.get("/", { preHandler: read }, async () => success(await service.list()));
  app.get("/:id", { preHandler: read }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", {
    preHandler: [app.authenticate, app.authorize("authorizers.create", "authorizers.manage")],
  }, async (request, reply) =>
    created(reply, await service.create(parseInput(clearanceAuthorizerMemberSchema, request.body))));
  app.put("/:id", { preHandler: edit }, async (request) =>
    success(await service.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(clearanceAuthorizerMemberSchema, request.body),
    )));
  app.put("/status/:id", { preHandler: edit }, async (request) =>
    success(await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
  app.delete("/:id", {
    preHandler: [app.authenticate, app.authorize("authorizers.delete", "authorizers.manage")],
  }, async (request) => success(await service.delete(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
