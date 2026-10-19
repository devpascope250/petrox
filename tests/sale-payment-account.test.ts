import { describe, expect, it, vi } from "vitest";
import { accountOfType } from "../src/modules/mobile/transactions/sale-rules.js";

/** A database whose account lookup returns the first row it is given. */
const db = (rows: Array<{ id: string; name: string }>) => ({
  companyAccount: { findFirst: vi.fn().mockResolvedValue(rows[0] ?? null) },
});

describe("the account a card or coupon sale is recorded against", () => {
  it("asks for an active account of that type, this site's before the company's", async () => {
    const database = db([{ id: "card-account", name: "Cards" }]);
    await expect(accountOfType(database as never, "site", "card")).resolves.toEqual({ id: "card-account", name: "Cards" });
    const { where, orderBy } = database.companyAccount.findFirst.mock.calls[0][0];
    expect(where).toEqual({ type: "card", status: "active", OR: [{ siteId: "site" }, { siteId: null }] });
    // Its own site first; a shared account (no site) last.
    expect(orderBy[0]).toEqual({ siteId: { sort: "asc", nulls: "last" } });
  });

  it("refuses when the company has no such account, naming the kind that is missing", async () => {
    await expect(accountOfType(db([]) as never, "site", "card")).rejects.toMatchObject({ statusCode: 422, code: "CARD_ACCOUNT_MISSING" });
    await expect(accountOfType(db([]) as never, "site", "coupon")).rejects.toMatchObject({ statusCode: 422, code: "COUPON_ACCOUNT_MISSING" });
  });
});
