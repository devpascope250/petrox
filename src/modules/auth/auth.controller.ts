import type { FastifyReply, FastifyRequest } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { AuthService, isOtpChallenge, type OtpChallenge, type Session } from "./auth.service.js";
import { changePasswordSchema, loginSchema, pinLoginSchema, resendOtpSchema, resetPasswordSchema, resetRequestSchema, verifyOtpSchema } from "./auth.schema.js";
import type { AppConfig } from "../../config/env.js";
import { unauthorized } from "../../utils/errors.js";

const accessTokenCookie = "access_token";
const refreshTokenCookie = "refresh_token";

export function sessionCookieOptions(config: AppConfig) {
  const apiUrl = new URL(config.APP_URL);
  const frontendUrl = new URL(config.FRONTEND_URL);
  const crossSite = apiUrl.hostname !== frontendUrl.hostname;
  const secure = config.NODE_ENV === "production" || apiUrl.protocol === "https:";

  return {
    path: "/",
    httpOnly: true,
    secure,
    // Cross-site cookies must be SameSite=None and Secure or browsers will not send them.
    sameSite: crossSite && secure ? "none" as const : "lax" as const,
  };
}

export class AuthController {
  constructor(private service: AuthService, private config: AppConfig) {}

  private cookieOptions() {
    return sessionCookieOptions(this.config);
  }

  private setSessionCookies(reply: FastifyReply, session: Session) {
    const options = this.cookieOptions();
    reply
      .setCookie(accessTokenCookie, session.accessToken, options)
      .setCookie(refreshTokenCookie, session.refreshToken, {
        ...options,
        maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 86_400
      });
  }

  private publicSession(session: Session) {
    const { accessToken: _accessToken, refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  private refreshToken(request: FastifyRequest) {
    const token = request.cookies[refreshTokenCookie];
    if (!token) throw unauthorized("Missing refresh token");
    return token;
  }

  /**
   * The password, which no longer signs anyone in on its own.
   *
   * It answers with a **challenge** — `otpRequired`, the challenge id and
   * where the code went — and no cookies are set. The session is issued by
   * `/auth/login/verify`. With `ALLOW_LOGIN_OTP=false` it answers with the
   * session instead, as it did before this step existed — so a client tells
   * the two apart by `otpRequired` rather than by guessing.
   */
  login = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = parseInput(loginSchema, request.body);
    const result = await this.service.login(input.email, input.password);
    if (isOtpChallenge(result)) return success(this.challenge(result));
    this.setSessionCookies(reply, result);
    return success(this.publicSession(result));
  };

  /** The code from the email: this is what issues the session. */
  verifyLoginOtp = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = parseInput(verifyOtpSchema, request.body);
    const session = await this.service.verifyLoginOtp(input.challengeId, input.code);
    this.setSessionCookies(reply, session);
    return success(this.publicSession(session));
  };

  /** Another code for the same login, when the first did not arrive. */
  resendLoginOtp = async (request: FastifyRequest) =>
    success(this.challenge(
      await this.service.resendLoginOtp(parseInput(resendOtpSchema, request.body).challengeId)));

  /** What a waiting login is told: never the code, and never the full address. */
  private challenge(challenge: OtpChallenge) {
    const { otpRequired, challengeId, email, expiresAt } = challenge;
    return { otpRequired, challengeId, email, expiresAt };
  }

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

  me = async (request: FastifyRequest) =>
    success(await this.service.me(request.contextUser!.userId));

  /**
   * Your own signature: the image stamped on documents you authorize. Only
   * ever your own — see the service.
   */
  saveSignature = async (request: FastifyRequest) =>
    success(await this.service.saveSignature(request.contextUser!.userId, request));

  removeSignature = async (request: FastifyRequest) =>
    success(await this.service.removeSignature(request.contextUser!.userId));

  /** The signed-in user's own permissions, by name, grouped by module. */
  myPermissions = async (request: FastifyRequest) =>
    success(await this.service.myPermissions(request.contextUser!.userId));

  /**
   * Changes your own password. Other sessions are dropped, so this one is
   * handed a fresh pair of cookies and carries on.
   */
  changePassword = async (request: FastifyRequest, reply: FastifyReply) => {
    const input = parseInput(changePasswordSchema, request.body);
    const session = await this.service.changePassword(request.contextUser!.userId, input);
    this.setSessionCookies(reply, session);
    return success(this.publicSession(session));
  };

  requestReset = async (request: FastifyRequest, reply: FastifyReply) =>
    created(reply, await this.service.createResetToken(parseInput(resetRequestSchema, request.body).email));

  resetPassword = async (request: FastifyRequest) => {
    const input = parseInput(resetPasswordSchema, request.body);
    await this.service.resetPassword(input.token, input.password);
    return success(null);
  };
}
