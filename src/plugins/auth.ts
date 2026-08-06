import fp from "fastify-plugin";
import { forbidden, unauthorized } from "../utils/errors.js";

export default fp(async (app) => {
  app.decorateRequest("contextUser", null);
  app.decorate("authenticate", async function (request) {
    try {
      await request.jwtVerify();
      request.contextUser = {
        userId: request.user.sub,
        roleId: request.user.roleId,
        role: request.user.role,
        permissions: request.user.permissions
      };
    } catch {
      throw unauthorized("Invalid or expired access token");
    }
  });
  app.decorate("authorize", (...required: string[]) => async function (request) {
    if (!request.contextUser) throw unauthorized();
    if (!required.every((permission) => request.contextUser!.permissions.includes(permission))) {
      throw forbidden();
    }
  });
}, { name: "auth", dependencies: ["jwt"] });
