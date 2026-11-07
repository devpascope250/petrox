import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { SupplierService } from "./supplier.service.js";
import { SupplerRepository } from "./supplier.repository.js";
import { createSupplierSchema, createSupplierTypeSchema } from "./supplier.schema.js";
import { sheetImportSchema } from "../../shared/import/sheet-import.js";
import { SupplierImporter } from "./supplier.import.js";
import { readSupplierBody } from "./supplier-upload.js";
const routes: FastifyPluginAsync = async (app) => {
  const repository = new SupplerRepository(app.prisma);
  const service = new SupplierService(repository, app.config);
  const importer = new SupplierImporter(app.prisma, repository);
  app.get("/", { preHandler: [app.authenticate, app.authorize("suppliers.read", "suppliers.manage")] }, async (request) =>
    success(await service.list(parseInput(paginationQuerySchema, request.query))));
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("suppliers.read", "suppliers.manage")] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  /**
   * JSON, or multipart when the supplier's paperwork travels with it — the
   * stored path is taken from the uploaded file, never from a text field.
   */
  app.post("/", { preHandler: [app.authenticate, app.authorize("suppliers.create", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.create(parseInput(createSupplierSchema, await readSupplierBody(request)))));

  /**
   * Many suppliers at once, from the downloaded template. Creating is creating,
   * however many at a time, so it is the same permission as the form — and the
   * answer says which rows were skipped and why, rather than failing the lot.
   */
  app.post("/import", { preHandler: [app.authenticate, app.authorize("suppliers.create", "suppliers.manage")] }, async (request) =>
    success(await importer.run(parseInput(sheetImportSchema, request.body))));

    /** Same two shapes as creating. No file sent keeps the document on file. */
    app.put("/:id", { preHandler: [app.authenticate, app.authorize("suppliers.edit", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.update(parseInput(idParamsSchema, request.params).id, parseInput(createSupplierSchema, await readSupplierBody(request)))));

     app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("suppliers.edit", "suppliers.manage")] }, async (request, reply) =>
    created(reply, await service.updateSupplierStatus(parseInput(idParamsSchema, request.params).id)));

    app.get("/supplier-type", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      success(await service.listSupplierType(parseInput(paginationQuerySchema, request.query))));

    app.get("/supplier-type/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      success(await service.findSupplierType(parseInput(idParamsSchema, request.params).id)));

     app.post("/supplier-type", { preHandler: [app.authenticate, app.authorize("suppliers.type.create", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply,await service.createSupplierType(parseInput(createSupplierTypeSchema, request.body))));

     app.put("/supplier-type/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply, await service.updateSupplierType(parseInput(idParamsSchema, request.params).id, parseInput(createSupplierTypeSchema, request.body))));

     app.put("/supplier-type/status/:id", { preHandler: [app.authenticate, app.authorize("suppliers.type.read", "suppliers.type.manage")] }, async (request, reply) =>
      created(reply, await service.updateSupplierTypeStatus(parseInput(idParamsSchema, request.params).id)));

};

export default routes;
