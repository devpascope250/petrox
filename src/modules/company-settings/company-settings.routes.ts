import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { CompanySettingsRepository } from "./company-settings.repository.js";
import { CompanySettingsService } from "./company-settings.service.js";

/**
 * The company profile printed on POS receipts, guarded by the "Company
 * Settings" module. One profile: `PUT` creates it the first time and updates
 * it after (JSON, or multipart with a `logo` image).
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new CompanySettingsService(new CompanySettingsRepository(app.prisma), app.config.STATIC_URL ?? app.config.APP_URL);

  app.get("/", { preHandler: [app.authenticate, app.authorize("company.settings.read", "company.settings.manage")] },
    async () => success(await service.get()));
  app.put("/", { preHandler: [app.authenticate, app.authorize("company.settings.edit", "company.settings.create", "company.settings.manage")] },
    async (request) => success(await service.save(request)));
  app.delete("/logo", { preHandler: [app.authenticate, app.authorize("company.settings.edit", "company.settings.manage")] },
    async () => success(await service.removeLogo()));
};

export default routes;
