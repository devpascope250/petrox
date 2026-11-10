import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { recordIdParamsSchema, idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CargoInvoiceRepository } from "./cargo-invoice.repository.js";
import { createCargoInvoiceSchema, updateCargoInvoiceSchema } from "./cargo-invoice.schema.js";
import { CargoInvoiceService } from "./cargo-invoice.service.js";
import { parseCargoInvoiceMultipart } from "./cargo-invoice-upload.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CargoInvoiceService(new CargoInvoiceRepository(app.prisma), app.config);

  /**
   * Every invoice on one **cargo**. The id in the path is the cargo's, and a
   * cargo id may be **either** a cuid or a uuid — see `recordIdSchema`. This
   * parsed a uuid first, which refused every database-made shipment, then a
   * cuid, which refused every seeded one.
   */
  app.get("/:id", { preHandler: [app.authenticate, app.authorize("cargo.read", "cargo.manage")] },
    async (request) => success(await service.list(parseInput(recordIdParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("cargo.create", "cargo.manage")] },
    async (request, reply) => {
      const body = request.isMultipart() ? await parseCargoInvoiceMultipart(request) : request.body;
      return created(reply, await service.create(parseInput(createCargoInvoiceSchema, body)));
    });

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("cargo.edit", "cargo.manage")] },
    async (request) => {
      const body = request.isMultipart() ? await parseCargoInvoiceMultipart(request) : request.body;
      return success(await service.update(
        parseInput(idParamsSchema, request.params).id,
        parseInput(updateCargoInvoiceSchema, body),
      ));
    });

  app.delete("/:id", { preHandler: [app.authenticate, app.authorize("cargo.edit", "cargo.manage")] },
    async (request) => success(await service.delete(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
