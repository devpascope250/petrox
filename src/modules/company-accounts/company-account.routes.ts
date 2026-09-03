import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { CompanyAccountRepository } from "./company-account.repository.js";
import {
  companyAccountParamsSchema,
  createCompanyAccountSchema,
  updateCompanyAccountSchema
} from "./company-account.schema.js";
import { CompanyAccountService } from "./company-account.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CompanyAccountService(new CompanyAccountRepository(app.prisma));

  app.get(
    "/",
    { preHandler: [app.authenticate, app.authorize("company.account.read")] },
    async (request) => success(await service.list(
      parseInput(paginationQuerySchema, request.query)
    ))
  );

  app.get(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("company.account.read")] },
    async (request) => success(await service.find(
      parseInput(companyAccountParamsSchema, request.params).id
    ))
  );

  app.post(
    "/",
    { preHandler: [app.authenticate, app.authorize("company.account.create")] },
    async (request, reply) => created(reply, await service.create(
      parseInput(createCompanyAccountSchema, request.body),
      request.contextUser!.userId
    ))
  );

  app.put(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("company.account.edit")] },
    async (request) => success(await service.update(
      parseInput(companyAccountParamsSchema, request.params).id,
      parseInput(updateCompanyAccountSchema, request.body)
    ))
  );

  app.patch(
    "/:id/status",
    { preHandler: [app.authenticate, app.authorize("company.account.edit")] },
    async (request) => success(await service.changeStatus(
      parseInput(companyAccountParamsSchema, request.params).id
    ))
  );
};

export default routes;
