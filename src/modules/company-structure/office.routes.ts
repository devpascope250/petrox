import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CompanyStructureRepository } from "./company-structure.repository.js";
import { CompanyStructureService } from "./company-structure.service.js";
import { createOfficeSchema, officeListQuerySchema } from "./company-structure.schema.js";

/**
 * Offices, each under a department. No delete, for the same reason as
 * departments: the staff who sit in one point at it.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new CompanyStructureService(new CompanyStructureRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("company.offices.read", "company.offices.manage")] },
    async (request) => success(await service.listOffices(parseInput(officeListQuerySchema, request.query))));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("company.offices.read", "company.offices.manage")] },
    async (request) => success(await service.findOffice(parseInput(idParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("company.offices.create", "company.offices.manage")] },
    async (request, reply) => created(reply, await service.createOffice(parseInput(createOfficeSchema, request.body))));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("company.offices.edit", "company.offices.manage")] },
    async (request) => success(await service.updateOffice(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createOfficeSchema, request.body)
    )));

  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("company.offices.edit", "company.offices.manage")] },
    async (request) => success(await service.updateOfficeStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
