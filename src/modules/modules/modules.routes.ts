import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { ModulesRepository } from "./modules.repository.js";
import { ModulesService } from "./modules.service.js";
import { paginationQuerySchema } from "../../shared/validation/index.js";
import { parseInput } from "../../shared/validation/parse.js";
import { moduleItemsSchemaBody, moduleSchemaBody, moduleSortingSchema, updateMouleSchemaBody } from "./module.schema.js";
import { deleteParamSchema } from "../roles/roles.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ModulesService(new ModulesRepository(app.prisma));

  app.get("/sidebar", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.sidebarForRole(request.contextUser!.roleId)));

  app.get("/list", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.findAll()));

  app.post("/create", async (request) =>  {
    return success(await service.createModule(parseInput(moduleSchemaBody, request.body)));
  })

  app.delete("/delete/:id", { preHandler: [app.authenticate]}, async (request) => {
    const input = parseInput(deleteParamSchema, request.params);
    return success(await service.deleteModule(input.id));
  });

  app.put("/edit", { preHandler: [app.authenticate]}, async (request) => {
    const data = parseInput(updateMouleSchemaBody, request.body);
    return success(await service.updateModule(data));
  })

  app.put("/change-module/sorting", { preHandler: [app.authenticate]}, async (request) => {
    const data = parseInput(moduleSortingSchema, request.body);
    return success(await service.updateSorting(data));
  })
  
};

export default routes;
