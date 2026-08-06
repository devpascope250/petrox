import type { FastifyInstance } from "fastify";
export const authorize = (app: FastifyInstance, ...permissions: string[]) => app.authorize(...permissions);
