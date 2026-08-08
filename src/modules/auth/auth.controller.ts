import type { FastifyReply, FastifyRequest } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { AuthService } from "./auth.service.js";
import { loginSchema, logoutSchema, pinLoginSchema, refreshSchema, resetPasswordSchema, resetRequestSchema } from "./auth.schema.js";

export class AuthController {
  constructor(private service: AuthService) {}

  login = async (request: FastifyRequest) => {
    const input = parseInput(loginSchema, request.body);
    return success(await this.service.login(input.email, input.password));
  };

  pinLogin = async (request: FastifyRequest) => {
    const input = parseInput(pinLoginSchema, request.body);
    return success(await this.service.loginWithPin(input.email, input.pin));
  };

  refresh = async (request: FastifyRequest) =>
    success(await this.service.refresh(parseInput(refreshSchema, request.body).refreshToken));

  logout = async (request: FastifyRequest) => {
    await this.service.logout(parseInput(logoutSchema, request.body).refreshToken);
    return success(null);
  };

  requestReset = async (request: FastifyRequest, reply: FastifyReply) =>
    created(reply, await this.service.createResetToken(parseInput(resetRequestSchema, request.body).email));

  resetPassword = async (request: FastifyRequest) => {
    const input = parseInput(resetPasswordSchema, request.body);
    await this.service.resetPassword(input.token, input.password);
    return success(null);
  };
}