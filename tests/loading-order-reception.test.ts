import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { CentralStockOrderRepository } from "../src/modules/central stock Orders/order.repository.js";

const decimal = (value: number) => new Prisma.Decimal(value);

function setup(siteReceived = 0, otherReceived = 0, balance = 0) {
  // One load, two sites: site-a ordered 40, site-b 60.
  const allocations = [
    { quantity: decimal(40), order: { siteId: "site-a", centralStock: { itemId: "fuel" } } },
    { quantity: decimal(60), order: { siteId: "site-b", centralStock: { itemId: "other-fuel" } } },
  ];
  const tx = {
    loadingOrder: {
      findFirst: vi.fn().mockImplementation(async (query) => ({
        id: "load", totalQuantity: decimal(100), status: "pending", authorizationStatus: "approved",
        driverVehicleId: "vehicle",
        // Only the lines for this site, whoever requested them.
        loadedOrders: allocations.filter(({ order }) => {
          const where = query.select.loadedOrders.where?.order;
          return !where || order.siteId === where.siteId;
        }),
        orderReceptions: [
          { receivedQty: decimal(siteReceived), cuve: { siteId: "site-a" } },
          { receivedQty: decimal(otherReceived), cuve: { siteId: "site-b" } },
        ],
      })),
      update: vi.fn(), count: vi.fn().mockResolvedValue(0),
    },
    tblCuve: { findFirst: vi.fn().mockResolvedValue({
      id: "cuve", itemId: "fuel", maximum: decimal(1000), balance: decimal(balance),
    }), update: vi.fn() },
    cuveTransaction: { create: vi.fn() },
    orderReception: { create: vi.fn().mockImplementation(async ({ data }) => ({ id: "reception", ...data })) },
    driverVehicles: { update: vi.fn() },
  };
  const repo = new CentralStockOrderRepository({
    $transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
  } as never);
  // A shortfall must be explained, so partial receipts carry a comment.
  return { tx, receive: (receivedQty: number, comment?: string, userId = "user") => repo.receiveLoadingOrder(
    "load", { cuveId: "cuve", receivedQty, comment }, { siteId: "site-a" }, userId,
  ) };
}

describe("mixed-site loading order reception", () => {
  it("increments existing stock and records an inbound receipt", async () => {
    const { tx, receive } = setup(0, 0, 960);
    await receive(40);
    expect(tx.tblCuve.update).toHaveBeenCalledWith({
      where: { id: "cuve" }, data: { balance: { increment: decimal(40) } },
    });
    expect(tx.cuveTransaction.create).toHaveBeenCalledWith({ data: {
      cuveId: "cuve", quantity: decimal(40), type: "received", direction: "IN",
      note: "Loading order load; reception reception",
      createdBy: "user", orderReceptionId: "reception",
    } });
  });

  it("rejects receipts exceeding the current balance capacity without writing stock", async () => {
    const { tx, receive } = setup(0, 0, 980);
    await expect(receive(21, "Tank nearly full")).rejects.toThrow("Cuve has capacity for only 20");
    expect(tx.orderReception.create).not.toHaveBeenCalled();
    expect(tx.tblCuve.update).not.toHaveBeenCalled();
    expect(tx.cuveTransaction.create).not.toHaveBeenCalled();
  });

  it("receives only the site's own allocation and keeps the load pending for others", async () => {
    const { tx, receive } = setup();
    await expect(receive(40)).resolves.toMatchObject({
      expectedQty: 40, remainingQuantity: 0, loadingOrderStatus: "pending",
    });
    expect(tx.driverVehicles.update).not.toHaveBeenCalled();
  });

  it("does not count another site's receipts against this site's remaining quantity", async () => {
    const { receive } = setup(10, 60);
    await expect(receive(20, "Rest arrives on the next trip")).resolves.toMatchObject({
      expectedQty: 40, remainingQuantity: 10, loadingOrderStatus: "pending",
    });
  });

  it("lets any manager at the site receive, counting what colleagues already took in", async () => {
    const { tx, receive } = setup(10);
    await expect(receive(30, undefined, "colleague")).resolves.toMatchObject({ remainingQuantity: 0 });
    expect(tx.orderReception.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ receivedBy: "colleague" }),
    }));
  });

  it("requires a comment when the total received falls short of what was sent", async () => {
    const { tx, receive } = setup(0);
    await expect(receive(25)).rejects.toThrow("explain the difference in a comment");
    expect(tx.orderReception.create).not.toHaveBeenCalled();
  });

  it("accepts an exact final receipt without a comment", async () => {
    const { receive } = setup(15);
    await expect(receive(25)).resolves.toMatchObject({ remainingQuantity: 0 });
  });

  it("rejects receiving more than the site's remaining allocation", async () => {
    const { tx, receive } = setup(10);
    await expect(receive(31)).rejects.toThrow("Only 30 remains to receive");
    expect(tx.orderReception.create).not.toHaveBeenCalled();
  });

  it("completes the load and releases the vehicle only after everyone receives", async () => {
    const { tx, receive } = setup(10, 60);
    await expect(receive(30)).resolves.toMatchObject({ loadingOrderStatus: "received", remainingQuantity: 0 });
    expect(tx.loadingOrder.update).toHaveBeenCalledWith({ where: { id: "load" }, data: { status: "received" } });
    expect(tx.driverVehicles.update).toHaveBeenCalledWith({ where: { id: "vehicle" }, data: { status: "active" } });
  });
});
