import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "../prisma/generated/prisma/client.js";
import planRoutes from "../src/modules/coupon-plans/coupon-plan.routes.js";
import couponRoutes from "../src/modules/client-coupons/client-coupon.routes.js";
import { globalErrorHandler } from "../src/utils/error-handler.js";
import { createCouponPlanSchema } from "../src/modules/coupon-plans/coupon-plan.schema.js";
import { createClientCouponSchema, updateClientCouponSchema } from "../src/modules/client-coupons/client-coupon.schema.js";

const id = "e805d56d-893b-4e36-8872-29d567a4bc5e";
describe("coupon CRUD", () => {
  async function setup(permission = true) {
    const app = Fastify();
    const delegate = () => ({
      findUnique: vi.fn().mockResolvedValue({ id }),
      findMany: vi.fn().mockResolvedValue([{ id }]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id, ...data })),
      update: vi.fn().mockImplementation(async ({ data }) => ({ id, ...data })),
      delete: vi.fn().mockResolvedValue({ id }),
    });
    const db = { couponPlan: delegate(), clientCoupon: delegate(), client: delegate(), $transaction: (ops: Promise<unknown>[]) => Promise.all(ops) };
    app.decorate("prisma", db as unknown as PrismaClient);
    app.decorate("authenticate", async request => {
      if (!request.headers.authorization) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    });
    app.decorate("authorize", (..._permissions: string[]) => async () => {
      if (!permission) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    });
    app.setErrorHandler(globalErrorHandler);
    await app.register(planRoutes, { prefix: "/plans" });
    await app.register(couponRoutes, { prefix: "/coupons" });
    return { app, db };
  }

  it("validates exact decimal amounts, required fields, enums and empty updates", () => {
    expect(createCouponPlanSchema.parse({ name: " Plan ", number: 1, amount: "9999999999999999.99" }).amount).toBe("9999999999999999.99");
    for (const amount of [null, true, "", -1, "1.001", "10000000000000000", 0]) {
      expect(createCouponPlanSchema.safeParse({ name: "Plan", number: 1, amount }).success).toBe(false);
    }
    expect(updateClientCouponSchema.safeParse({}).success).toBe(false);
    expect(createClientCouponSchema.safeParse({ couponPlanId: id, clientId: id, amount: 1, status: "bad" }).success).toBe(false);
    expect(updateClientCouponSchema.safeParse({ printedAt: null }).success).toBe(true);
  });

  it("serves create/list/detail/update/status/delete for both resources", async () => {
    const { app, db } = await setup();
    try {
      const headers = { authorization: "test" };
      for (const [url, payload] of [
        ["/plans", { name: "Plan", number: 10, amount: "25.50" }],
        ["/coupons", { clientId: id, couponPlanId: id, amount: "25.50" }],
      ] as const) {
        const created = await app.inject({ method: "POST", url, headers, payload });
        expect(created.statusCode).toBe(201);
        if (url === "/coupons") {
          expect(created.json().data.code).toEqual(expect.any(String));
          expect(created.json().data.token).toHaveLength(64);
        }
        expect((await app.inject({ url: url + "?page=2&pageSize=5", headers })).json().data.pagination.page).toBe(2);
        expect((await app.inject({ url: url + "/" + id, headers })).statusCode).toBe(200);
        expect((await app.inject({ method: "PUT", url: url + "/" + id, headers, payload: { amount: "30.00" } })).statusCode).toBe(200);
        expect((await app.inject({ method: "PATCH", url: url + "/" + id + "/status", headers, payload: { status: url === "/plans" ? "inactive" : "cancelled" } })).statusCode).toBe(200);
        expect((await app.inject({ method: "DELETE", url: url + "/" + id, headers })).statusCode).toBe(200);
      }
      db.clientCoupon.count.mockResolvedValue(1);
      expect((await app.inject({ method: "DELETE", url: "/plans/" + id, headers })).statusCode).toBe(409);
      db.client.findUnique.mockResolvedValue(null as never);
      expect((await app.inject({ method: "POST", url: "/coupons", headers, payload: { clientId: id, couponPlanId: id, amount: 1 } })).statusCode).toBe(404);
      db.couponPlan.findUnique.mockResolvedValue(null as never);
      expect((await app.inject({ url: "/plans/" + id, headers })).statusCode).toBe(404);
      db.clientCoupon.create.mockRejectedValue(Object.assign(new Error("Duplicate"), { code: "P2002" }));
      db.client.findUnique.mockResolvedValue({ id });
      db.couponPlan.findUnique.mockResolvedValue({ id });
      expect((await app.inject({ method: "POST", url: "/coupons", headers, payload: { clientId: id, couponPlanId: id, amount: 1 } })).statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it("requires authentication and permission and rejects invalid IDs", async () => {
    const { app } = await setup(false);
    try {
      for (const url of ["/plans", "/coupons"]) {
        expect((await app.inject({ url })).statusCode).toBe(401);
        expect((await app.inject({ url, headers: { authorization: "test" } })).statusCode).toBe(403);
      }
    } finally { await app.close(); }
    const allowed = await setup();
    try {
      expect((await allowed.app.inject({ url: "/coupons/invalid", headers: { authorization: "test" } })).statusCode).toBe(400);
    } finally { await allowed.app.close(); }
  });
});
