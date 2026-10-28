import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { SubsidyRepository } from "./subsidy.repository.js";
import {
  activeSubsidyQuerySchema, createSubsidySchema, subsidyListQuerySchema, subsidyParamsSchema, updateSubsidySchema,
} from "./subsidy.schema.js";
import { SubsidyService } from "./subsidy.service.js";

/**
 * What the state pays towards a litre of a product: `/subsidies`, guarded by
 * the "Subsidies" module (`subsidies.*`).
 *
 * A product carries **one active subsidy at a time**, so recording one or
 * switching one on retires the one it replaces. Each answer says how many it
 * retired, as `replaced`.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new SubsidyService(new SubsidyRepository(app.prisma));
  const id = (params: unknown) => parseInput(subsidyParamsSchema, params).id;

  app.get("/", { preHandler: [app.authenticate, app.authorize("subsidies.read")] }, async (request) =>
    success(await service.list(parseInput(subsidyListQuerySchema, request.query), request.contextUser!)));

  // The one in force for a product right now, for a form or a receipt.
  app.get("/active", { preHandler: [app.authenticate, app.authorize("subsidies.read")] }, async (request) =>
    success(await service.active(parseInput(activeSubsidyQuerySchema, request.query), request.contextUser!)));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("subsidies.read")] }, async (request) =>
    success(await service.find(id(request.params), request.contextUser!)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("subsidies.create")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createSubsidySchema, request.body), request.contextUser!)));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("subsidies.edit")] }, async (request) =>
    success(await service.update(id(request.params), parseInput(updateSubsidySchema, request.body), request.contextUser!)));

  app.patch("/:id/status", { preHandler: [app.authenticate, app.authorize("subsidies.edit")] }, async (request) =>
    success(await service.changeStatus(id(request.params), request.contextUser!)));

  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("subsidies.delete")] }, async (request) =>
    success(await service.delete(id(request.params), request.contextUser!)));
};

export default routes;
