import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { ModulesRepository } from "./modules.repository.js";
import { ModulesService } from "./modules.service.js";
import { parseInput } from "../../shared/validation/parse.js";
import { moduleItemsSchemaBody, moduleSchemaBody } from "./module.schema.js";
import { deleteParamSchema } from "../roles/roles.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ModulesService(new ModulesRepository(app.prisma));

  app.get("/sidebar", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.sidebarForRole(request.contextUser!.roleId)));

  app.get("/list", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.findAll()));

  app.post("/create", {preHandler: [app.authenticate]}, async (request) =>  {
    return success(await service.createModule(parseInput(moduleSchemaBody, request.body)));
  })

  app.delete("/delete/:id", { preHandler: [app.authenticate]}, async (request) => {
    const input = parseInput(deleteParamSchema, request.params);
    return success(await service.deleteModule(input.id));
  });

  app.put("/edit/:id", { preHandler: [app.authenticate]}, async (request) => {
    const input = parseInput(deleteParamSchema, request.params);
    const data = parseInput(moduleItemsSchemaBody, request.body);
    return success(await service.updateModule(input.id, data));
  })
  
};

export default routes;