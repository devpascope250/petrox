import type { FastifyReply } from "fastify";

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export const success = <T>(data: T): SuccessResponse<T> => ({ success: true, data });

export function created<T>(reply: FastifyReply, data: T) {
  return reply.code(201).send(success(data));
}
