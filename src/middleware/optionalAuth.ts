import type { preHandlerHookHandler } from "fastify";
import { AuthRepository } from "../modules/auth/auth.repository.js";

/**
 * Like `app.authenticate`, but a request without a valid session goes on as
 * anonymous (`contextUser` null) instead of being refused. A signed-in user is
 * read from the database, as `authenticate` does, so `position`, `siteId` and
 * `clientId` are current and a deleted user counts as signed out.
 */
export const optionalAuth: preHandlerHookHandler = async (request) => {
  request.contextUser = null;
  try {
    await request.jwtVerify();
  } catch {
    return;
  }
  const user = await new AuthRepository(request.server.prisma).findUserById(request.user.sub);
  if (!user) return;
  request.contextUser = {
    userId: request.user.sub,
    roleId: request.user.roleId,
    role: request.user.role,
    permissions: user.role ? user.role.permissions.map((item) => item.permission.code) : [],
    position: user.position,
    clientId: user.clientId,
    siteId: user.sites.length > 0 ? user.sites[0].siteId : null,
  };
};
