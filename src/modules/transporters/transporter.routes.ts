import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { TransporterService } from "./transporter.js";
import { TransporterRepository } from "./transporter.repository.js";
import { createTransporterSchema } from "./transporter.schema.js";
import { sheetImportSchema } from "../../shared/import/sheet-import.js";
import { TransporterImporter } from "./transporter.import.js";
const routes: FastifyPluginAsync = async (app) => {
  const repository = new TransporterRepository(app.prisma);
  const service = new TransporterService(repository, app.config);
  const importer = new TransporterImporter(app.prisma, repository);
  app.get("/", { preHandler: [app.authenticate, app.authorize("transporters.read", "transporters.manage")] }, async (request) =>
    success(await service.list()));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("transporters.read", "transporters.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", { preHandler: [app.authenticate, app.authorize("transporters.create", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createTransporterSchema, request.body))));

  /** Many transporters at once, from the downloaded template. */
  app.post("/import", { preHandler: [app.authenticate, app.authorize("transporters.create", "transporters.manage")] }, async (request) =>
    success(await importer.run(parseInput(sheetImportSchema, request.body))));

    app.put("/:id", { preHandler: [app.authenticate, app.authorize("transporters.edit", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createTransporterSchema, request.body))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("transporters.edit", "transporters.manage")] }, async (request, reply) =>
    created(reply, await service.updateStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;