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
 function hasPermission(
  userPermissions: readonly string[],
  requiredPermission: string
): boolean {
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  const parts = requiredPermission.split(".");

  if (parts.length < 2) {
    return false;
  }

  const resource = parts.slice(0, -1).join(".");
  const managePermission = `${resource}.manage`;

  return userPermissions.includes(managePermission);
}

app.decorate(
  "authorize",
  (...required: string[]) =>
    async function (request) {
      if (!request.contextUser) {
        throw unauthorized();
      }

      const permissions = request.contextUser.permissions;

      if (!required.every((permission) =>
        hasPermission(permissions, permission)
      )) {
        throw forbidden();
      }
    }
);
}, { name: "auth", dependencies: ["jwt"] });
