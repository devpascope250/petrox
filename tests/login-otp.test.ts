import bcrypt from "bcryptjs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthController, sessionCookieOptions } from "../src/modules/auth/auth.controller.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { hashPin } from "../src/utils/crypto.js";
import { emailService } from "../src/utils/emailService.js";
import type { AppConfig } from "../src/config/env.js";

/**
 * Signing in takes two steps: the password, then a code emailed to the address
 * on the account. These cover what the step is for — that the password alone
 * sets no cookie, that a code is good once, and that a six-digit code cannot
 * simply be guessed.
 *
 * The mail is stubbed on the singleton: `emailService` reads its own config, so
 * this is the only way a test can be sure nothing is sent. See the
 * MAIL_TRANSPORT note in the README.
 */
const SECRET = "x".repeat(32);
const config = {
  NODE_ENV: "test",
  APP_URL: "https://api.example.com",
  FRONTEND_URL: "https://app.example.net",
  REFRESH_TOKEN_TTL_DAYS: 30,
  ACCESS_TOKEN_TTL: "15m",
  PIN_HMAC_SECRET: SECRET,
  LOGIN_OTP_TTL_MINUTES: 10,
  LOGIN_OTP_MAX_ATTEMPTS: 3,
  ALLOW_LOGIN_OTP: true,
} as AppConfig;

const PASSWORD = "Str0ngPass!";
const user = {
  id: "user-1",
  email: "pascal@ikwim.rw",
  firstName: "Pascal",
  lastName: "N",
  isActive: true,
  roleId: "role-1",
  role: { id: "role-1", name: "Manager", isActive: true, permissions: [] },
  sites: [],
  client: null,
  signatureUrl: null,
  position: "siteManager",
  clientId: null,
  // A real hash, so the password check is the real one.
  passwordHash: bcrypt.hashSync(PASSWORD, 4),
};

/** A challenge store in memory, so the rules are tested and not Prisma. */
function fakeRepo(challenge: Record<string, unknown>) {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(user as never),
    findUserById: vi.fn().mockResolvedValue(user as never),
    createRefreshToken: vi.fn().mockResolvedValue({}),
    createLoginOtp: vi.fn(async (userId: string, codeHash: string, expiresAt: Date) => {
      Object.assign(challenge, { id: "challenge-1", userId, codeHash, expiresAt, attempts: 0, usedAt: null });
      return challenge;
    }),
    findLoginOtp: vi.fn(async (id: string) => (challenge.id === id ? { ...challenge } : null)),
    countLoginOtpAttempt: vi.fn(async () => {
      challenge.attempts = (challenge.attempts as number) + 1;
      return { ...challenge };
    }),
    consumeLoginOtp: vi.fn(async () => {
      challenge.usedAt = new Date();
      return { ...challenge };
    }),
  };
}

const app = { jwt: { sign: () => "access-token" } } as never;

describe("a login is confirmed by a code emailed to the account", () => {
  let sent: Array<{ to: string; code: string }>;

  beforeEach(() => {
    sent = [];
    emailService.sendLoginOtpEmail = (async (to: string, _name: string, code: string) => {
      sent.push({ to, code });
    }) as typeof emailService.sendLoginOtpEmail;
  });

  it("the right password answers with a challenge, and emails the code to the account", async () => {
    const challenge: Record<string, unknown> = {};
    const repo = fakeRepo(challenge);
    const service = new AuthService(repo as never, app, config);

    const result = await service.login(user.email, PASSWORD);

    expect(result).toMatchObject({ otpRequired: true, challengeId: "challenge-1" });
    // Masked, and to a fixed width: the screen says where to look without
    // echoing the address, or its length, back to whoever typed the password.
    expect((result as { email: string }).email).toBe("pa****@ikwim.rw");
    // The code went to the address **on the account**, never one a request named.
    expect(sent).toEqual([{ to: user.email, code: expect.stringMatching(/^\d{6}$/) }]);
    // Only its HMAC is stored, so a dump of the table is not a working code.
    expect(challenge.codeHash).not.toBe(sent[0]!.code);
    expect(challenge.codeHash).toBe(hashPin(sent[0]!.code, SECRET));
  });

  it("sends no code to a wrong password", async () => {
    const challenge: Record<string, unknown> = {};
    const service = new AuthService(fakeRepo(challenge) as never, app, config);
    await expect(service.login(user.email, "not-the-password")).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("the code is good once, and is spent before the session is issued", async () => {
    const challenge: Record<string, unknown> = {};
    const repo = fakeRepo(challenge);
    const service = new AuthService(repo as never, app, config);
    const code = "123456";
    Object.assign(challenge, {
      id: "challenge-1", userId: user.id, codeHash: hashPin(code, SECRET),
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, usedAt: null,
    });

    const session = await service.verifyLoginOtp("challenge-1", code);
    expect(session.accessToken).toBe("access-token");
    expect(repo.consumeLoginOtp).toHaveBeenCalled();

    // Spent: the same code must not sign anyone in a second time.
    await expect(service.verifyLoginOtp("challenge-1", code)).rejects.toThrow();
  });

  it("dies at the attempt limit, so six digits cannot be tried one by one", async () => {
    const challenge: Record<string, unknown> = {};
    const repo = fakeRepo(challenge);
    const service = new AuthService(repo as never, app, config);
    const code = "123456";
    Object.assign(challenge, {
      id: "challenge-1", userId: user.id, codeHash: hashPin(code, SECRET),
      expiresAt: new Date(Date.now() + 60_000), attempts: 0, usedAt: null,
    });

    for (let at = 0; at < config.LOGIN_OTP_MAX_ATTEMPTS; at += 1) {
      await expect(service.verifyLoginOtp("challenge-1", "000000")).rejects.toThrow();
    }
    // The right code, too late: the challenge was spent on the last wrong try.
    await expect(service.verifyLoginOtp("challenge-1", code)).rejects.toThrow();
  });

  it("an expired code is refused", async () => {
    const challenge: Record<string, unknown> = {};
    const repo = fakeRepo(challenge);
    const service = new AuthService(repo as never, app, config);
    Object.assign(challenge, {
      id: "challenge-1", userId: user.id, codeHash: hashPin("123456", SECRET),
      expiresAt: new Date(Date.now() - 1_000), attempts: 0, usedAt: null,
    });
    await expect(service.verifyLoginOtp("challenge-1", "123456")).rejects.toThrow();
  });

  it("the password step sets no session cookie; the code step sets both", async () => {
    const service = {
      login: vi.fn().mockResolvedValue({
        otpRequired: true, challengeId: "challenge-1",
        email: "pa****@ikwim.rw", expiresAt: new Date("2026-11-09T12:00:00.000Z"),
      }),
      verifyLoginOtp: vi.fn().mockResolvedValue({
        accessToken: "new-access", refreshToken: "new-refresh", user: { id: "user-1" }, permissions: [],
      }),
    };
    const server = Fastify();
    await server.register(cookie);
    const controller = new AuthController(service as never, config);
    server.post("/login", controller.login);
    server.post("/login/verify", controller.verifyLoginOtp);

    const first = await server.inject({
      method: "POST", url: "/login",
      payload: { email: "pascal@ikwim.rw", password: "Str0ngPass!" },
    });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).data).toMatchObject({ otpRequired: true, email: "pa****@ikwim.rw" });
    expect(first.headers["set-cookie"]).toBeUndefined();

    const second = await server.inject({
      method: "POST", url: "/login/verify",
      payload: { challengeId: "6f5b2d6e-7c9a-4a1b-8f3c-2f1e5d4c3b2a", code: "123456" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("access_token=new-access"),
      expect.stringContaining("refresh_token=new-refresh"),
    ]));
    await server.close();
  });

  it("keeps the session cookies' own rules", () => {
    expect(sessionCookieOptions(config)).toMatchObject({ httpOnly: true, secure: true, sameSite: "none" });
  });
});
