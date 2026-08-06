import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { ModulesRepository } from "./modules.repository.js";
import { ModulesService } from "./modules.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new ModulesService(new ModulesRepository(app.prisma));

  app.get("/sidebar", { preHandler: [app.authenticate] }, async (request) =>
    success(await service.sidebarForRole(request.contextUser!.roleId)));
};

export default routes;