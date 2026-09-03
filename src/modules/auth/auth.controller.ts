import type { FastifyReply, FastifyRequest } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { AuthService } from "./auth.service.js";
import { loginSchema, pinLoginSchema, resetPasswordSchema, resetRequestSchema } from "./auth.schema.js";
import type { AppConfig } from "../../config/env.js";
import { unauthorized } from "../../utils/errors.js";

const accessTokenCookie = "access_token";
const refreshTokenCookie = "refresh_token";

export class AuthController {
  constructor(private service: AuthService, private config: AppConfig) {}

  private cookieOptions() {
    return {
      path: "/",
      httpOnly: true,
      secure: this.config.NODE_ENV === "production",
      sameSite: "lax" as const
    };
  }

  private setSessionCookies(reply: FastifyReply, session: Awaited<ReturnType<AuthService["login"]>>) {
    const options = this.cookieOptions();
    reply
      .setCookie(accessTokenCookie, session.accessToken, options)
      .setCookie(refreshTokenCookie, session.refreshToken, {
        ...options,
        maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 86_400
      });
  }

  private publicSession(session: Awaited<ReturnType<AuthService["login"]>>) {
    const { accessToken: _accessToken, refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  private refreshToken(request: FastifyRequest) {
    const token = request.cookies[refreshTokenCookie];
    if (!token) throw unauthorized("Missing refresh token");
    return token;
  }

  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = parseInput(loginSchema, request.body);
    const session = await this.service.login(input.email, input.password);
    this.setSessionCookies(reply, session);
    return success(this.publicSession(session));
  };

  pinLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = parseInput(pinLoginSchema, request.body);
    const session = await this.service.loginWithPin(input.email, input.pin);
    this.setSessionCookies(reply, session);
    return success(this.publicSession(session));
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await this.service.refresh(this.refreshToken(request));
    this.setSessionCookies(reply, session);
    return success(this.publicSession(session));
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    const refreshToken = request.cookies[refreshTokenCookie];
    if (refreshToken) await this.service.logout(refreshToken);
    const options = this.cookieOptions();
    reply.clearCookie(accessTokenCookie, options).clearCookie(refreshTokenCookie, options);
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
