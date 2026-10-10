import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { NozzleRepository } from "./nozzle.repository.js";
import { NozzleService } from "./nozzle.service.js";
import { bindNozzleCodeSchema, createNozzleSchema, nozzleCodeLookupSchema, nozzleListQuerySchema } from "./nozzle.schema.js";
const routes: FastifyPluginAsync = async (app) => {
  const service = new NozzleService(new NozzleRepository(app.prisma), app.config);
  // The full list, kept as it was for pickers that need every nozzle.
  app.get("/", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.list()));
  // A page at a time, newest first, by site, pump or search — for the Nozzles page.
  app.get("/paged", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.listPage(parseInput(nozzleListQuerySchema, request.query))));
  // Registered before "/:id". Checks a scanned code before it is bound.
  app.get("/by-code", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.findByCode(parseInput(nozzleCodeLookupSchema, request.query).code)));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("nozzle.read", "nozzle.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("nozzle.create", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createNozzleSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("nozzle.edit", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createNozzleSchema, request.body))));

  // Binds the record to the physical nozzle by the code scanned off it.
  app.patch("/:id/code", { preHandler: [app.authenticate, app.authorize("nozzle.edit", "nozzle.manage")] }, async (request) =>
    success(await service.bindCode(parseInput(idParamsSchema, request.params).id, parseInput(bindNozzleCodeSchema, request.body).nozzleCode)));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("nozzle.edit", "nozzle.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;