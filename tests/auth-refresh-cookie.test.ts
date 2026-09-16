import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { AuthController, sessionCookieOptions } from "../src/modules/auth/auth.controller.js";
import type { AppConfig } from "../src/config/env.js";

const config = {
  NODE_ENV: "development",
  APP_URL: "https://api.example.com",
  FRONTEND_URL: "https://app.example.net",
  REFRESH_TOKEN_TTL_DAYS: 30,
} as AppConfig;

describe("refresh-token cookies", () => {
  it("uses Secure and SameSite=None for a cross-site HTTPS frontend", () => {
    expect(sessionCookieOptions(config)).toMatchObject({
      path: "/", httpOnly: true, secure: true, sameSite: "none",
    });
  });

  it("reads refresh_token from the request cookie and rotates both cookies", async () => {
    const session = { accessToken: "new-access", refreshToken: "new-refresh", user: { id: "user" }, permissions: [] };
    const service = { refresh: vi.fn().mockResolvedValue(session) };
    const app = Fastify();
    await app.register(cookie);
    const controller = new AuthController(service as never, config);
    app.post("/refresh", controller.refresh);

    const response = await app.inject({ method: "POST", url: "/refresh", headers: { cookie: "refresh_token=old-refresh" } });

    expect(response.statusCode).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith("old-refresh");
    expect(response.headers["set-cookie"]).toEqual(expect.arrayContaining([
      expect.stringContaining("access_token=new-access"),
      expect.stringContaining("refresh_token=new-refresh"),
    ]));
    await app.close();
  });
});
