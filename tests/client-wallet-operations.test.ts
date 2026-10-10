import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "../prisma/generated/prisma/client.js";
import routes from "../src/modules/client-wallets/client-wallet.routes.js";
import { globalErrorHandler } from "../src/utils/error-handler.js";

const walletId = "cjld2cjxh0000qzrmn831i7rn";
const clientId = "e805d56d-893b-4e36-8872-29d567a4bc5e";
const planId = "7de52860-00c0-4907-a665-d210eeeb8c2b";
const otherPlanId = "0b9a3c1e-5f2d-4e7a-8c6b-1d2e3f4a5b6c";
const plan = (id: string, amount: string, number = 100, issued = 0) =>
  ({ id, name: `Plan ${amount}`, number, amount: new Prisma.Decimal(amount), _count: { clientCoupons: issued } });

async function setup() {
  const wallet = { id: walletId, clientId, status: "active", amount: new Prisma.Decimal(100) };
  const db = {
    clientWallet: {
      findFirst: vi.fn().mockResolvedValue(wallet),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(wallet)
    },
    couponPlan: { findMany: vi.fn().mockResolvedValue([plan(planId, "12.50")]) },
    clientCoupon: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: "coupon-id", ...data })) },
    cardCopy: { findFirst: vi.fn().mockResolvedValue({ id: 3n }) },
    card: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 5n, balance: new Prisma.Decimal(25) })
    },
    cardCopyTransaction: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: 9n, ...data })) },
    walletTransaction: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: "movement-id", ...data })) },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db))
  };
  const app = Fastify();
  await app.register(multipart);
  app.decorate("prisma", db as unknown as PrismaClient);
  app.decorate("authenticate", async request => {
    if (!request.headers.authorization) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    request.contextUser = {
      userId: clientId, clientId, position: "clientUser", roleId: "role", role: "client", permissions: [], siteId: null
    };
  });
  app.decorate("authorize", () => async request => {
    if (request.headers.authorization === "denied") throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  });
  app.setErrorHandler(globalErrorHandler);
  await app.register(routes);
  const post = (operation: string, payload: object, authorization = "allowed") => app.inject({
    method: "POST", url: `/${walletId}/${operation}`, headers: { authorization }, payload
  });
  return { app, db, post };
}

describe("wallet operations", () => {
  it("buys coupons at the stored plan price and links outgoing movements", async () => {
    const { app, db, post } = await setup();
    try {
      const response = await post("buy-coupons", { couponPlanId: planId, quantity: 2 });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.amount).toBe("25");
      expect(db.clientWallet.updateMany).toHaveBeenCalledWith({
        where: { id: walletId, clientId, status: "active", amount: { gte: new Prisma.Decimal(25) } },
        data: { amount: { decrement: new Prisma.Decimal(25) } }
      });
      expect(db.clientCoupon.create).toHaveBeenCalledTimes(2);
      expect(db.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ referenceId: "coupon-id", type: "PAYMENT", direction: "OUT" })
      }));
      expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    } finally { await app.close(); }
  });

  it("sells coupons of several plans in one debit", async () => {
    const { app, db, post } = await setup();
    try {
      db.couponPlan.findMany.mockResolvedValue([plan(planId, "12.50"), plan(otherPlanId, "20.00")] as never);
      const response = await post("buy-coupons", {
        items: [{ couponPlanId: planId, quantity: 2 }, { couponPlanId: otherPlanId, quantity: 3 }]
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.amount).toBe("85");
      expect(db.clientWallet.updateMany).toHaveBeenCalledTimes(1);
      expect(db.clientWallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { amount: { decrement: new Prisma.Decimal(85) } }
      }));
      expect(db.clientCoupon.create).toHaveBeenCalledTimes(5);
    } finally { await app.close(); }
  });

  it("refuses more coupons than a plan has left, before taking payment", async () => {
    const { app, db, post } = await setup();
    try {
      db.couponPlan.findMany.mockResolvedValue([plan(planId, "12.50", 10, 8)] as never);
      const response = await post("buy-coupons", { items: [{ couponPlanId: planId, quantity: 3 }] });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("COUPON_PLAN_EXHAUSTED");
      expect(db.clientWallet.updateMany).not.toHaveBeenCalled();
      expect(db.clientCoupon.create).not.toHaveBeenCalled();
      expect((await post("buy-coupons", { items: [{ couponPlanId: planId, quantity: 2 }] })).statusCode).toBe(201);
    } finally { await app.close(); }
  });

  it("rejects a sale naming the same plan twice", async () => {
    const { app, post } = await setup();
    try {
      const response = await post("buy-coupons", {
        items: [{ couponPlanId: planId, quantity: 1 }, { couponPlanId: planId, quantity: 1 }]
      });
      expect(response.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("moves money from the wallet to a main card", async () => {
    const { app, db, post } = await setup();
    try {
      const response = await post("card-transfer", { direction: "TO_CARD", cardId: "5", amount: "25" });
      expect(response.statusCode).toBe(201);
      expect(db.clientWallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { amount: { decrement: new Prisma.Decimal(25) } }
      }));
      expect(db.card.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { balance: { increment: new Prisma.Decimal(25) } }
      }));
      expect(db.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: "TRANSFER", direction: "OUT" })
      }));
      expect(db.cardCopyTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ direction: "IN" })
      }));
    } finally { await app.close(); }
  });

  it("moves money from a main card back to the wallet", async () => {
    const { app, db, post } = await setup();
    try {
      const response = await post("card-transfer", { direction: "FROM_CARD", cardId: "5", amount: "10" });
      expect(response.statusCode).toBe(201);
      expect(db.card.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ balance: { gte: new Prisma.Decimal(10) } }),
        data: { balance: { decrement: new Prisma.Decimal(10) } }
      }));
      expect(db.clientWallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { amount: { increment: new Prisma.Decimal(10) } }
      }));
      expect(db.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: "TRANSFER", direction: "IN" })
      }));
    } finally { await app.close(); }
  });

  it("refuses a card transfer from a card without enough balance, or not the client's main card", async () => {
    const { app, db, post } = await setup();
    try {
      db.card.updateMany.mockResolvedValueOnce({ count: 0 } as never);
      expect((await post("card-transfer", { direction: "FROM_CARD", cardId: "5", amount: "999" })).statusCode).toBe(422);
      expect(db.walletTransaction.create).not.toHaveBeenCalled();
      db.cardCopy.findFirst.mockResolvedValueOnce(null as never);
      expect((await post("card-transfer", { direction: "TO_CARD", cardId: "7", amount: "1" })).statusCode).toBe(404);
      expect((await post("card-transfer", { direction: "SIDEWAYS", cardId: "5", amount: "1" })).statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it("credits an assigned card and records both sides with JSON-safe IDs", async () => {
    const { app, db, post } = await setup();
    try {
      const response = await post("transfer-to-card", { cardId: "5", amount: "25" });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.card.id).toBe("5");
      expect(response.json().data.cardTransaction.carfdCopyId).toBe("3");
      expect(db.cardCopy.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { clientId, status: true, OR: [{ cardId: 5n }, { cardCopyId: 5n }] }
      }));
      expect(db.cardCopyTransaction.create).toHaveBeenCalledWith({
        data: { carfdCopyId: 3n, type: "TRANSFER", direction: "IN", amount: new Prisma.Decimal(25), createdById: clientId }
      });
      expect(db.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ referenceId: "9", type: "TRANSFER", direction: "OUT" })
      }));
    } finally { await app.close(); }
  });

  it.each(["buy-coupons", "transfer-to-card"])("rejects insufficient funds for %s before creating value", async operation => {
    const { app, db, post } = await setup();
    try {
      db.clientWallet.updateMany.mockResolvedValue({ count: 0 });
      const response = await post(operation, operation === "buy-coupons" ? { couponPlanId: planId } : { cardId: "5", amount: "25" });
      expect(response.statusCode).toBe(422);
      expect(db.clientCoupon.create).not.toHaveBeenCalled();
      expect(db.card.updateMany).not.toHaveBeenCalled();
      expect(db.walletTransaction.create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rejects inactive plans, other clients' cards and unavailable wallets", async () => {
    const { app, db, post } = await setup();
    try {
      db.couponPlan.findMany.mockResolvedValue([] as never);
      expect((await post("buy-coupons", { couponPlanId: planId })).statusCode).toBe(404);
      db.cardCopy.findFirst.mockResolvedValue(null as never);
      expect((await post("transfer-to-card", { cardId: "5", amount: "25" })).statusCode).toBe(404);
      expect(db.clientWallet.updateMany).not.toHaveBeenCalled();
      db.clientWallet.findFirst.mockResolvedValue(null as never);
      expect((await post("buy-coupons", { couponPlanId: planId })).statusCode).toBe(404);
      expect(db.clientWallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: walletId, clientId } }));
    } finally { await app.close(); }
  });

  it("rejects inactive wallets and aborts when the card cannot be credited", async () => {
    const { app, db, post } = await setup();
    try {
      db.clientWallet.findFirst.mockResolvedValueOnce({
        id: walletId, clientId, status: "inactive", amount: new Prisma.Decimal(100)
      });
      expect((await post("buy-coupons", { couponPlanId: planId })).statusCode).toBe(422);
      expect(db.clientWallet.updateMany).not.toHaveBeenCalled();
      db.card.updateMany.mockResolvedValue({ count: 0 });
      expect((await post("transfer-to-card", { cardId: "5", amount: "25" })).statusCode).toBe(422);
      expect(db.cardCopyTransaction.create).not.toHaveBeenCalled();
      expect(db.walletTransaction.create).not.toHaveBeenCalled();
      await expect(db.$transaction.mock.results[1].value).rejects.toThrow("Card is inactive");
    } finally { await app.close(); }
  });

  it("rejects invalid input, unauthorized requests and generic debits", async () => {
    const { app, post } = await setup();
    try {
      expect((await post("buy-coupons", { couponPlanId: planId, quantity: 0 })).statusCode).toBe(400);
      expect((await post("buy-coupons", { couponPlanId: planId, amount: "1" })).statusCode).toBe(400);
      expect((await post("transfer-to-card", { cardId: "5", amount: "0" })).statusCode).toBe(400);
      expect((await post("buy-coupons", { couponPlanId: planId }, "")).statusCode).toBe(401);
      expect((await post("buy-coupons", { couponPlanId: planId }, "denied")).statusCode).toBe(403);
      expect((await post("movements", { type: "WITHDRAWAL", amount: "1" })).statusCode).toBe(422);
    } finally { await app.close(); }
  });
});
