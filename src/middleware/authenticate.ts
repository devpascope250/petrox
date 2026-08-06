import type { preHandlerHookHandler } from "fastify";
export const authenticate = (handler: preHandlerHookHandler) => handler;
