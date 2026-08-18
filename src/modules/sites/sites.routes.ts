import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { createSiteSchema } from "./sites.schema.js";
import { SiteRepository } from "./sites.repository.js";
import { SitesService } from "./sites.service.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new SitesService(new SiteRepository(app.prisma), app.config);
  app.get("/", { preHandler: [app.authenticate, app.authorize("pss.read", "pss.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("pss.read", "pss.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("pss.create", "pss.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createSiteSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("pss.edit", "pss.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createSiteSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("pss.edit", "pss.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;