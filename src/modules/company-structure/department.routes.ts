import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CompanyStructureRepository } from "./company-structure.repository.js";
import { CompanyStructureService } from "./company-structure.service.js";
import { createDepartmentSchema, departmentListQuerySchema } from "./company-structure.schema.js";

/**
 * Departments. There is no delete: a department is on its offices, which are
 * on their staff, so taking one out of use is `PUT /status/:id`.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new CompanyStructureService(new CompanyStructureRepository(app.prisma));

  app.get("/", { preHandler: [app.authenticate, app.authorize("company.departments.read", "company.departments.manage")] },
    async (request) => success(await service.listDepartments(parseInput(departmentListQuerySchema, request.query))));

  app.get("/:id", { preHandler: [app.authenticate, app.authorize("company.departments.read", "company.departments.manage")] },
    async (request) => success(await service.findDepartment(parseInput(idParamsSchema, request.params).id)));

  app.post("/", { preHandler: [app.authenticate, app.authorize("company.departments.create", "company.departments.manage")] },
    async (request, reply) => created(reply, await service.createDepartment(parseInput(createDepartmentSchema, request.body))));

  app.put("/:id", { preHandler: [app.authenticate, app.authorize("company.departments.edit", "company.departments.manage")] },
    async (request) => success(await service.updateDepartment(
      parseInput(idParamsSchema, request.params).id,
      parseInput(createDepartmentSchema, request.body)
    )));

  app.put("/status/:id", { preHandler: [app.authenticate, app.authorize("company.departments.edit", "company.departments.manage")] },
    async (request) => success(await service.updateDepartmentStatus(parseInput(idParamsSchema, request.params).id)));
};

export default routes;
