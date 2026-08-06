import type { preHandlerHookHandler } from "fastify";

export const optionalAuth: preHandlerHookHandler = async (request) => {
  try {
    await request.jwtVerify();
    request.contextUser = { userId: request.user.sub, roleId: request.user.roleId,
        role: request.user.role, permissions: request.user.permissions };
  } catch {
    request.contextUser = null;
  }
};
