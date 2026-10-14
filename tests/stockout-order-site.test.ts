import { describe, expect, it } from "vitest";
import type { AuthUser } from "../src/shared/auth/context-user.js";
import { parseInput } from "../src/shared/validation/index.js";
import { CentralStockOrderService } from "../src/modules/central stock Orders/order.service.js";
import { createCentralStockOrderSchema } from "../src/modules/central stock Orders/order.schema.js";

const ITEM = "7c1f5a40-0f0e-4f7a-9d2a-1b2c3d4e5f60";
const OWN_SITE = "3e97dd25-e2ba-4915-a0bf-6b3c5409380b";
const actor = (position: AuthUser["position"], siteId: string | null): AuthUser => ({
  userId: "5b8c1f0e-1d2a-4c3b-8e9f-0a1b2c3d4e5f", position, roleId: "role-id", role: "Role", permissions: [], siteId, clientId: null,
});
const service = new CentralStockOrderService({} as never, {} as never);

/** What the create route parses: the body, the creator, then the fields site staff cannot choose. */
const order = (body: object, who: AuthUser) =>
  parseInput(createCentralStockOrderSchema, { ...body, createdBy: who.userId, ...service.siteOrderFields(who) });

describe("placing a stockout order", () => {
  it("orders for the site manager's own site without asking for one", () => {
    expect(order({ itemId: ITEM, quantity: 100, unitPrice: 1500 }, actor("siteManager", OWN_SITE)))
      .toMatchObject({ siteId: OWN_SITE, orderType: "internal", status: "pending" });
  });

  it("ignores any site, type, status or approver a site manager sends", () => {
    const parsed = order({
      itemId: ITEM, quantity: 100, unitPrice: 1500, orderType: "b2b",
      siteId: "00000000-0000-4000-a000-000000000000", status: "approved", approvedBy: "5b8c1f0e-1d2a-4c3b-8e9f-0a1b2c3d4e5f",
    }, actor("siteManager", OWN_SITE));
    expect(parsed).toMatchObject({ siteId: OWN_SITE, orderType: "internal", status: "pending" });
    expect(parsed.approvedBy).toBeUndefined();
  });

  it("still makes a super administrator name the site of an internal order", () => {
    expect(() => order({ itemId: ITEM, quantity: 100, unitPrice: 1500 }, actor("superAdmin", null))).toThrow();
    expect(order({ itemId: ITEM, quantity: 100, unitPrice: 1500, siteId: OWN_SITE }, actor("superAdmin", null)))
      .toMatchObject({ siteId: OWN_SITE });
  });

  it("never lets site staff approve, reject or cancel an order", () => {
    expect(() => service.changeOrderStatus("order", "approved", actor("siteManager", OWN_SITE)))
      .toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  it("refuses site staff who have no site", () => {
    expect(() => service.siteOrderFields(actor("siteManager", null))).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});
