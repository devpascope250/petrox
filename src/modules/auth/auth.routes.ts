import type { FastifyPluginAsync } from "fastify";
import { AuthController } from "./auth.controller.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  const controller = new AuthController(new AuthService(new AuthRepository(app.prisma), app, app.config), app.config);
  const limited = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };
  app.post("/login", limited, controller.login);
  app.post("/pin-login", limited, controller.pinLogin);
  app.post("/refresh", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, controller.refresh);
  app.post("/logout", controller.logout);
  app.post("/password-reset/request", controller.requestReset);
  app.post("/password-reset/confirm", limited, controller.resetPassword);
};
export default authRoutes;
