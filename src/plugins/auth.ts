import fp from "fastify-plugin";
import { forbidden, unauthorized } from "../utils/errors.js";
import { AuthRepository } from "../modules/auth/auth.repository.js";

export default fp(async (app) => {
  app.decorateRequest("contextUser", null);
  const authRepo = new AuthRepository(app.prisma)
  app.decorate("authenticate", async function (request) {
    try {
      await request.jwtVerify();
      const user = await authRepo.findUserById(request.user.sub);
      if(!user) throw unauthorized();
      const permissions = user?.role ? user.role.permissions.map((item) => item.permission.code) : null;
      const siteId = (user?.sites && user?.sites?.length > 0) ? user.sites[0].siteId : null;
      request.contextUser = {
        userId: request.user.sub,
        roleId: request.user.roleId,
        role: request.user.role,
        permissions: (permissions as readonly string[]),
        position: user.position,
        clientId: user?.clientId,
        siteId: siteId
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

      if (!required.some((permission) =>  hasPermission(permissions, permission))) {
        throw forbidden();
      }
    }
);
}, { name: "auth", dependencies: ["jwt"] });
