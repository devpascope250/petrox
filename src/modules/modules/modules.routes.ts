import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { ModulesRepository } from "./modules.repository.js";
import { ModulesService } from "./modules.service.js";
import { paginationQuerySchema } from "../../shared/validation/index.js";
import { parseInput } from "../../shared/validation/parse.js";
import { moduleItemsSchemaBody, moduleSchemaBody, moduleSortingSchema, updateModuleFieldsSchema, updateMouleSchemaBody } from "./module.schema.js";
import { deleteParamSchema } from "../roles/roles.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ModulesService(new ModulesRepository(app.prisma));

  app.get("/sidebar", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.sidebarForRole(request.contextUser!.roleId)));

  // The Modules page, and the Roles page, which builds its permission picker
  // from this list — so either module's read permission is enough.
  app.get("/list", { preHandler: [app.authenticate, app.authorize("modules.read", "roles.read")] }, async (request) =>
    success(await service.findAll()));

  // Was open to anyone, logged in or not.
  app.post("/create", { preHandler: [app.authenticate, app.authorize("modules.create")] }, async (request) =>  {
    return success(await service.createModule(parseInput(moduleSchemaBody, request.body)));
  })

  app.delete("/delete/:id", { preHandler: [app.authenticate, app.authorize("modules.delete")] }, async (request) => {
    const input = parseInput(deleteParamSchema, request.params);
    return success(await service.deleteModule(input.id));
  });

  // The id in the path — what the Modules page calls. This route was changed to
  // `/edit` (id in the body) without the page being updated, so every edit
  // returned ROUTE_NOT_FOUND; both forms are accepted now.
  app.put("/edit/:id", { preHandler: [app.authenticate, app.authorize("modules.edit")] }, async (request) => {
    const { id } = parseInput(deleteParamSchema, request.params);
    const data = parseInput(updateModuleFieldsSchema, request.body);
    return success(await service.updateModule({ id, ...data }));
  })

  app.put("/edit", { preHandler: [app.authenticate, app.authorize("modules.edit")] }, async (request) => {
    const data = parseInput(updateMouleSchemaBody, request.body);
    return success(await service.updateModule(data));
  })

  app.put("/change-module/sorting", { preHandler: [app.authenticate, app.authorize("modules.edit")] }, async (request) => {
    const data = parseInput(moduleSortingSchema, request.body);
    return success(await service.updateSorting(data));
  })
  
};

export default routes;
