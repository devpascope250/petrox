import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../../shared/validation/index.js";
import { TaxDescriptionRepository } from "./tax.repository.js";
import { TaxDescriptionService } from "./tax.service.js";
import { createTaxDescriptionSchema } from "./tax.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new TaxDescriptionService(new TaxDescriptionRepository(app.prisma));
  const read = [app.authenticate, app.authorize("clearance.taxes.read", "clearance.taxes.manage")];
  const write = [app.authenticate, app.authorize("clearance.taxes.create", "clearance.taxes.manage")];
  const edit = [app.authenticate, app.authorize("clearance.taxes.edit", "clearance.taxes.manage")];

  app.get("/", { preHandler: read }, async () => success(await service.list()));
  // Whoever may raise a clearance has to be able to pick the taxes on it,
  // which is not the same as being allowed to keep the catalogue.
  app.get("/active", {
    preHandler: [app.authenticate, app.authorize(
      "clearance.taxes.read", "clearance.taxes.manage",
      "stock.clearance.create", "stock.clearance.manage",
    )],
  }, async () => success(await service.active()));
  app.get("/:id", { preHandler: read }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: write }, async (request, reply) =>
    created(reply, await service.create(parseInput(createTaxDescriptionSchema, request.body))));
  app.put("/:id", { preHandler: edit }, async (request) =>
    success(await service.update(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createTaxDescriptionSchema, request.body),
    )));
  app.put("/status/:id", { preHandler: edit }, async (request) =>
    success(await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
  app.delete("/:id", {
    preHandler: [app.authenticate, app.authorize("clearance.taxes.delete", "clearance.taxes.manage")],
  }, async (request) => success(await service.delete(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
