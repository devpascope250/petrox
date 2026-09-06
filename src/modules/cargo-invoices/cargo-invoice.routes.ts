import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CargoInvoiceRepository } from "./cargo-invoice.repository.js";
import { createCargoInvoiceSchema, updateCargoInvoiceSchema } from "./cargo-invoice.schema.js";
import { CargoInvoiceService } from "./cargo-invoice.service.js";
import { parseCargoInvoiceMultipart } from "./cargo-invoice-upload.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CargoInvoiceService(new CargoInvoiceRepository(app.prisma), app.config);

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("cargo.read", "cargo.manage")] },
    async (request) => success(await service.list(parseInput(idParamsSchema, request.params).id)));

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
