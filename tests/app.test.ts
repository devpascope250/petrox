import type { PrismaClient } from "../generated/prisma/client.js";
import fp from "fastify-plugin";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/plugins/prisma.js", () => ({
  default: fp(async (app) => { app.decorate("prisma", {} as PrismaClient); }, { name: "prisma" })
}));

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { BusinessError } from "../src/utils/errors.js";

const config = loadConfig();

describe("HTTP API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp(config, { logger: false });
    app.get("/__test/business-error", async () => {
      throw new BusinessError("STOCK_UNAVAILABLE", "Requested stock is unavailable", 422, { available: 0 });
    });
    app.get("/__test/prisma-conflict", async () => {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002", meta: { target: ["email"] } });
    });
    app.get("/__test/unexpected-error", async () => {
      throw new Error("sensitive internal message");
    });    app.get("/__test/context-user", { preHandler: [app.authenticate] }, async (request) => ({
      success: true,
      data: request.contextUser
    }));
    await app.ready();
  });
  afterAll(async () => app.close());
  it("reports health through Supertest", async () => {
    const response = await request(app.server).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: "ok" } });
  });
  it("returns structured Zod validation failures", async () => {
    const response = await request(app.server).post("/api/v1/auth/login").send({ email: "bad", password: "short" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(response.body.error.requestId).toEqual(expect.any(String));
    expect(response.body.error.details).toEqual([
      { field: "email", code: "invalid_format", message: "Must be a valid email address" },
      { field: "password", code: "too_small", message: "Must contain at least 8 characters" }
    ]);
    expect(response.body.error).not.toHaveProperty("data");
  });
  it("protects authenticated endpoints", async () => {
    const response = await request(app.server).get("/api/v1/users");
    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({ statusCode: 401, code: "UNAUTHORIZED" });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
  it("formats business errors with safe data", async () => {
    const response = await request(app.server).get("/__test/business-error");
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      statusCode: 422,
      code: "STOCK_UNAVAILABLE",
      message: "Requested stock is unavailable",
      data: { available: 0 }
    });
  });
  it("maps Prisma constraint errors to conflicts", async () => {
    const response = await request(app.server).get("/__test/prisma-conflict");
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      statusCode: 409,
      code: "RESOURCE_CONFLICT",
      data: { fields: ["email"] }
    });
  });
  it("does not leak unexpected internal errors", async () => {
    const response = await request(app.server).get("/__test/unexpected-error");
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.text).not.toContain("sensitive internal message");
  });
  it("formats unknown routes consistently", async () => {
    const response = await request(app.server).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ statusCode: 404, code: "ROUTE_NOT_FOUND" });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it("passes the authenticated identity through contextUser", async () => {
    const token = app.jwt.sign({
      sub: "user-id",
      roleId: "role-id",
      role: "Manager",
      permissions: ["users.read"]
    });
    const response = await request(app.server)
      .get("/__test/context-user")
      .set("authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { userId: "user-id", roleId: "role-id", role: "Manager", permissions: ["users.read"] }
    });
  });
});



