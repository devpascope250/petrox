import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { CuveRepository } from "../src/modules/Cuve/cuve.repository.js";
import { CuveService } from "../src/modules/Cuve/cuve.service.js";
import routes from "../src/modules/Cuve/cuve.routes.js";
import { cuveTransactionsQuerySchema } from "../src/modules/Cuve/cuve.schema.js";
import type { AuthUser } from "../src/shared/auth/context-user.js";

const d = (value: number) => new Prisma.Decimal(value);
const id = "00000000-0000-4000-8000-000000000001";
const actor = { position: "siteManager", siteId: "own-site" } as AuthUser;
const cuve = { id, name: "Tank", itemId: "fuel", siteId: "own-site", balance: d(120),
  minimum: d(10), maximum: d(1000), deadStock: d(5), status: "active",
  item: { id: "fuel", name: "Diesel", baseUnit: null }, site: { id: "own-site", name: "Site" } };

function setup() {
  const tx = {
    tblCuve: { findFirst: vi.fn().mockResolvedValue(cuve), findMany: vi.fn().mockResolvedValue([cuve]) },
    cuveTransaction: {
      findMany: vi.fn().mockResolvedValue([{ id: "txn", quantity: d(50), direction: "IN", sale: null }]),
      count: vi.fn().mockResolvedValue(3),
      groupBy: vi.fn().mockResolvedValueOnce([
        { direction: "IN", _sum: { quantity: d(50) } },
        { direction: "OUT", _sum: { quantity: d(20) } },
      ]).mockResolvedValueOnce([{ direction: "IN", _sum: { quantity: d(10) } }]),
    },
  };
  Object.assign(tx, { fuelSale: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) } });
  const db = { ...tx, $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx)) };
  return { tx, db, repo: new CuveRepository(db as never) };
}

describe("cuve stock reports", () => {
  it("groups current balances by item while retaining individual cuves", async () => {
    const { tx, repo } = setup();
    tx.tblCuve.findMany.mockResolvedValue([cuve, { ...cuve, id: "second", balance: d(30) },
      { ...cuve, id: "third", itemId: "petrol", item: { ...cuve.item, id: "petrol", name: "Petrol" }, balance: d(40) }]);
    const result = await repo.stocks({ siteId: "own-site" });
    expect(tx.tblCuve.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { siteId: "own-site" } }));
    expect(result.cuves).toHaveLength(3);
    expect(result.summary.items.map(({ balance }) => balance)).toEqual([150, 40]);
  });

  it("summarizes the entire period independently of the page and subtracts later movements", async () => {
    const { tx, repo } = setup();
    const query = cuveTransactionsQuerySchema.parse({ startDate: "2026-09-01", endDate: "2026-09-10", pageSize: 1 });
    const result = await repo.transactions(id, query, "own-site");
    expect(result.summary).toMatchObject({ transactionCount: 3, totalIn: 50, totalOut: 20,
      netMovement: 30, openingBalance: 80, closingBalance: 110, currentBalance: 120 });
    expect(result.items).toHaveLength(1);
    expect(result.pagination.totalPages).toBe(3);
    expect(tx.tblCuve.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, siteId: "own-site" } }));
    expect(tx.cuveTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { cuveId: id, createdAt: {
      gte: new Date("2026-09-01T00:00:00Z"), lte: new Date("2026-09-10T23:59:59.999Z"),
    } } }));
  });

  it("returns unchanged balances for an empty period", async () => {
    const { tx, repo } = setup();
    tx.cuveTransaction.groupBy.mockReset().mockResolvedValue([]);
    tx.cuveTransaction.findMany.mockResolvedValue([]);
    tx.cuveTransaction.count.mockResolvedValue(0);
    const result = await repo.transactions(id, cuveTransactionsQuerySchema.parse({}));
    expect(result.summary).toMatchObject({ totalIn: 0, totalOut: 0, netMovement: 0,
      openingBalance: 120, closingBalance: 120, transactionCount: 0 });
  });

  it("does not query transactions for a cuve outside the permitted site", async () => {
    const { tx, repo } = setup();
    tx.tblCuve.findFirst.mockResolvedValue(null as never);
    await expect(repo.transactions(id, cuveTransactionsQuerySchema.parse({}), "own-site")).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.cuveTransaction.findMany).not.toHaveBeenCalled();
  });

  it("forces the manager's site and rejects client users or unassigned managers", async () => {
    const repo = { stocks: vi.fn(), transactions: vi.fn() };
    const service = new CuveService(repo as never, {} as never);
    service.stocks({ siteId: "other-site" }, actor);
    expect(repo.stocks).toHaveBeenCalledWith({ siteId: "own-site" });
    expect(() => service.stocks({}, { ...actor, siteId: null })).toThrow();
    expect(() => service.transactions(id, cuveTransactionsQuerySchema.parse({}), { ...actor, position: "clientAdmin" })).toThrow();
    service.stocks({ siteId: "other-site" }, { ...actor, position: "superAdmin" });
    expect(repo.stocks).toHaveBeenLastCalledWith({ siteId: "other-site" });
  });

  it("requires super administrators to select a site before querying stock", () => {
    const repo = { stocks: vi.fn() };
    const service = new CuveService(repo as never, {} as never);
    expect(() => service.stocks({}, { ...actor, position: "superAdmin" }))
      .toThrow(expect.objectContaining({ statusCode: 400, code: "SITE_ID_REQUIRED" }));
    expect(repo.stocks).not.toHaveBeenCalled();
    service.stocks({}, actor);
    expect(repo.stocks).toHaveBeenCalledWith({ siteId: "own-site" });
  });

  it("validates dates and pagination", () => {
    for (const query of [{ startDate: "invalid" }, { endDate: "2026-02-30" },
      { startDate: "2026-09-11", endDate: "2026-09-10" }, { page: 0 }, { pageSize: 101 }]) {
      expect(cuveTransactionsQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it("exposes both authenticated reporting routes", async () => {
    const { db } = setup();
    const app = Fastify();
    app.decorate("prisma", db);
    app.decorate("config", {} as never);
    app.decorate("authenticate", async (request: FastifyRequest) => { request.contextUser = actor; });
    const authorize = vi.fn(() => async () => {});
    app.decorate("authorize", authorize);
    await app.register(routes, { prefix: "/api/v1/cuves" });
    try {
      const stock = await app.inject({ method: "GET", url: "/api/v1/cuves/stocks" });
      expect(stock.statusCode).toBe(200);
      expect(stock.json().data.cuves[0].balance).toBe(120);
      const transactions = await app.inject({ method: "GET", url: `/api/v1/cuves/${id}/transactions?endDate=2026-09-10` });
      expect(transactions.statusCode).toBe(200);
      expect(transactions.json().data.summary.netMovement).toBe(30);
      expect(authorize).toHaveBeenCalledWith("cuve.stock.read", "cuve.read", "cuve.manage");
    } finally { await app.close(); }
  });
});
