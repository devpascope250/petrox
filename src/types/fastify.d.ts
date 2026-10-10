import type { PrismaClient } from "../../generated/prisma/client.js";
import type { AppConfig } from "../config/env.js";
import type { AuthUser } from "../shared/auth/context-user.js";
import type { AuthDevice } from "../modules/mobile/auth/device-auth.ts";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    config: AppConfig;
    authenticate: import("fastify").preHandlerHookHandler;
    authorize: (...permissions: string[]) => import("fastify").preHandlerHookHandler;
  }
  interface FastifyRequest {
    contextUser: AuthUser | null;
    /** The POS device behind a mobile request, set by the mobile module's device authentication. */
    device: AuthDevice | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; roleId: string; role: string;};
    user: { sub: string; roleId: string; role: string; permissions: string[] };
  }
}
