import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/shared/auth/context-user.js";
import { PosTransactionService } from "../src/modules/pos-transactions/pos-transaction.service.js";

const actor = (position: AuthUser["position"], siteId: string | null): AuthUser => ({
  userId: "user-id", position, roleId: "role-id", role: "Role", permissions: [], siteId, clientId: null,
});
const query = { page: 1, pageSize: 20, siteId: "other-site" };
/** The report takes the same filters without a page. */
const reportQuery = { siteId: "other-site" };

describe("POS transaction report access", () => {
  it("holds site staff to their own site, whatever site is asked for", async () => {
    const repo = { list: vi.fn(), find: vi.fn(), report: vi.fn() };
    const service = new PosTransactionService(repo as never);
    await service.list(query, actor("siteManager", "own-site"));
    await service.find("sale", actor("others", "own-site"));
    await service.report(reportQuery, actor("siteManager", "own-site"));
    expect(repo.list).toHaveBeenCalledWith("own-site", query);
    expect(repo.find).toHaveBeenCalledWith("sale", "own-site");
    expect(repo.report).toHaveBeenCalledWith("own-site", reportQuery);
  });

  it("lets a super administrator see every site, or narrow to one", async () => {
    const repo = { list: vi.fn(), find: vi.fn(), report: vi.fn() };
    const service = new PosTransactionService(repo as never);
    await service.list(query, actor("superAdmin", null));
    await service.list({ page: 1, pageSize: 20 }, actor("superAdmin", null));
    await service.find("sale", actor("superAdmin", null));
    await service.report(reportQuery, actor("superAdmin", null));
    await service.report({}, actor("superAdmin", null));
    expect(repo.list).toHaveBeenNthCalledWith(1, "other-site", query);
    expect(repo.list).toHaveBeenNthCalledWith(2, undefined, { page: 1, pageSize: 20 });
    expect(repo.find).toHaveBeenCalledWith("sale", undefined);
    expect(repo.report).toHaveBeenNthCalledWith(1, "other-site", reportQuery);
    expect(repo.report).toHaveBeenNthCalledWith(2, undefined, {});
  });

  it("refuses client users and site staff without a site", async () => {
    const service = new PosTransactionService({} as never);
    expect(() => service.list(query, actor("clientAdmin", null))).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => service.find("sale", actor("siteManager", null))).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => service.report(reportQuery, actor("clientUser", null))).toThrow(expect.objectContaining({ statusCode: 403 }));
  });
});
