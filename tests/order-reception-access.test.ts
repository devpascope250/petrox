import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/shared/auth/context-user.js";
import { CentralStockOrderService } from "../src/modules/central stock Orders/order.service.js";

const actor = (position: AuthUser["position"], siteId: string | null): AuthUser => ({
  userId: "user-id",
  position,
  roleId: "role-id",
  role: "Role",
  permissions: [],
  siteId,
  clientId: null,
});

describe("order reception access", () => {
  it("forces a site manager's own site onto reception queries", async () => {
    const repo = { listReceptionOrders: vi.fn().mockResolvedValue([[], 0]) };
    const service = new CentralStockOrderService(repo as never, {} as never);
    await service.listReceptionOrders({ page: 1, pageSize: 20, siteId: "other-site" }, actor("siteManager", "own-site"));
    // The scope, not the query's `siteId`, decides what he sees: every order
    // for his own site, whoever raised it.
    expect(repo.listReceptionOrders).toHaveBeenCalledWith(
      { page: 1, pageSize: 20, siteId: "other-site" },
      { siteId: "own-site" },
    );
  });

  it("allows super administrators to query across sites", async () => {
    const repo = { listReceptionOrders: vi.fn().mockResolvedValue([[], 0]) };
    const service = new CentralStockOrderService(repo as never, {} as never);
    await service.listReceptionOrders({ page: 1, pageSize: 20 }, actor("superAdmin", null));
    expect(repo.listReceptionOrders).toHaveBeenCalledWith({ page: 1, pageSize: 20 }, undefined);
  });

  it("rejects client positions and site managers without a site", async () => {
    const service = new CentralStockOrderService({} as never, {} as never);
    await expect(service.listReceptionOrders(
      { page: 1, pageSize: 20 }, actor("clientAdmin", null),
    )).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.listReceptionOrders(
      { page: 1, pageSize: 20 }, actor("siteManager", null),
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  it("only permits site managers to receive into a cuve", async () => {
    const service = new CentralStockOrderService({} as never, {} as never);
    await expect(service.receiveLoadingOrder(
      "loading-order", { cuveId: "cuve", receivedQty: 10 }, actor("superAdmin", null),
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});
