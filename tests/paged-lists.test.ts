import { describe, expect, it, vi } from "vitest";
import { CargoRepository } from "../src/modules/cargo/cargo.repository.js";
import { cargoListQuerySchema } from "../src/modules/cargo/cargo.schema.js";
import { OrderRepository } from "../src/modules/orders/orders.repository.js";
import { orderListQuerySchema } from "../src/modules/orders/orders.schema.js";
import { NominationRepository } from "../src/modules/nominations/nominations.repository.js";
import { nominationListQuerySchema } from "../src/modules/nominations/nominations.schema.js";
import { PfiRepository } from "../src/modules/pfi/pfi.repository.js";
import { T1ValidationRepository } from "../src/modules/t1 validation/t1-validation.repository.js";
import { CentralStockOrderRepository } from "../src/modules/central stock Orders/order.repository.js";
import { loadingOrderListQuerySchema } from "../src/modules/central stock Orders/order.schema.js";
import { pagedDatesQuerySchema } from "../src/shared/validation/index.js";

/**
 * A database that records the arguments every list query is built with, and
 * answers one row and a count of 97 — so a page can be told from the whole.
 */
function spyDb() {
  const calls: any[] = [];
  const model = {
    findMany: vi.fn((args: unknown) => {
      calls.push(args);
      return { kind: "findMany", args };
    }),
    count: vi.fn((args: unknown) => {
      calls.push(args);
      return { kind: "count", args };
    }),
  };
  const db: any = new Proxy(
    { $transaction: vi.fn(async (queries: any[]) => [[{ id: "row", cargos: [], quantity: 0, loadedOrders: [], orderReceptions: [] }], 97]) },
    { get: (target, key) => (key in target ? (target as any)[key] : model) },
  );
  return { db, calls, model };
}

const page = { page: 3, pageSize: 10 };

describe("every growing list asks the database for one page", () => {
  it("orders: skips to the page, counts the same filter, and keeps the date window", async () => {
    const { db, model } = spyDb();
    const query = orderListQuerySchema.parse({ ...page, startDate: "2026-01-01", endDate: "2026-01-31", search: "ORD" });
    const [items, total] = await new OrderRepository(db).list(query);

    const findMany = model.findMany.mock.calls[0][0] as any;
    expect(findMany).toMatchObject({ skip: 20, take: 10 });
    expect(findMany.where.orderDate).toEqual({ gte: query.startDate, lte: query.endDate });
    expect(findMany.where.OR).toHaveLength(3);
    // The count must see exactly the same filter, or the page count lies.
    expect((model.count.mock.calls[0][0] as any).where).toEqual(findMany.where);
    expect(total).toBe(97);
    expect(items).toHaveLength(1);
  });

  it("cargo: windows on the received date and matches its references", async () => {
    const { db, model } = spyDb();
    const query = cargoListQuerySchema.parse({ ...page, startDate: "2026-02-01", search: "BL-1", status: "pending" });
    await new CargoRepository(db).list(query);

    const findMany = model.findMany.mock.calls[0][0] as any;
    expect(findMany).toMatchObject({ skip: 20, take: 10, where: { status: "pending" } });
    expect(findMany.where.receivedDate).toEqual({ gte: query.startDate });
    expect((model.count.mock.calls[0][0] as any).where).toEqual(findMany.where);
  });

  it("nominations: pages inside the window, narrowed to one product", async () => {
    const { db, model } = spyDb();
    const query = nominationListQuerySchema.parse({ ...page, itemId: "00000000-0000-4000-8000-000000000001" });
    const window = { startDate: new Date("2026-03-01"), endDate: new Date("2026-03-31") };
    await new NominationRepository(db).list({ ...query, ...window });

    const findMany = model.findMany.mock.calls[0][0] as any;
    expect(findMany).toMatchObject({ skip: 20, take: 10 });
    expect(findMany.where.nominationVessels).toEqual({ some: { stock: { itemId: query.itemId } } });
    expect(findMany.where.createdAt).toEqual({ gte: window.startDate, lte: window.endDate });
    expect((model.count.mock.calls[0][0] as any).where).toEqual(findMany.where);
  });

  it("PFI and T1 validation: page inside the window they are given", async () => {
    const query = pagedDatesQuerySchema.parse(page);
    const window = { startDate: new Date("2026-04-01"), endDate: new Date("2026-04-30") };

    for (const run of [
      (db: any) => new PfiRepository(db).list({ ...query, ...window }),
      (db: any) => new T1ValidationRepository(db).list({ ...query, ...window }),
    ]) {
      const { db, model } = spyDb();
      await run(db);
      const findMany = model.findMany.mock.calls[0][0] as any;
      expect(findMany).toMatchObject({ skip: 20, take: 10 });
      expect(findMany.where.createdAt).toEqual({ gte: window.startDate, lte: window.endDate });
      expect((model.count.mock.calls[0][0] as any).where).toEqual(findMany.where);
    }
  });

  it("loading orders: pages the window, and its stage counts leave the stage out", async () => {
    const { db, model } = spyDb();
    const query = loadingOrderListQuerySchema.parse({
      ...page, startDate: "2026-05-01", endDate: "2026-05-31", search: "RAB", stage: "toReceive",
    });
    const repo = new CentralStockOrderRepository(db);
    const [loads, total] = await repo.listLoadingOrders(query);

    const findMany = model.findMany.mock.calls[0][0] as any;
    expect(findMany).toMatchObject({ skip: 20, take: 10 });
    // Every filter is an `AND` member: the window, the search and the stage.
    expect(findMany.where.AND).toEqual(expect.arrayContaining([
      { createdAt: { gte: query.startDate, lte: query.endDate } },
    ]));
    // The count must see exactly the same filter, or the page count lies.
    expect((model.count.mock.calls[0][0] as any).where).toEqual(findMany.where);
    expect(total).toBe(97);
    expect(loads).toHaveLength(1);

    // The badges count the whole window, so the stage cannot also narrow them.
    const counts = spyDb();
    await new CentralStockOrderRepository(counts.db).loadingOrderStageCounts(query);
    const unfiltered = (counts.model.count.mock.calls[0][0] as any).where;
    expect(JSON.stringify(unfiltered)).not.toContain("orderReceptions");
  });

  it("defaults to the first page of twenty when a client asks for no page", () => {
    expect(pagedDatesQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    // A page size is capped, so one client cannot ask for the whole table.
    expect(pagedDatesQuerySchema.safeParse({ pageSize: 5000 }).success).toBe(false);
  });
});
