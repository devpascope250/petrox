import { describe, expect, it, vi } from "vitest";
import { retireExpired } from "../src/modules/discounts/expiry-sweep.js";

/** A database that records what each sweep asked to update. */
function db(counts = { discounts: 2, subsidies: 1 }) {
  return {
    discount: { updateMany: vi.fn().mockResolvedValue({ count: counts.discounts }) },
    subsidy: { updateMany: vi.fn().mockResolvedValue({ count: counts.subsidies }) },
  };
}

/** 10:00 Rwanda on 3 November — 08:00 UTC. */
const MORNING = new Date("2026-11-03T08:00:00Z");

describe("retiring rates whose last day has passed", () => {
  it("switches off the active ones that ended before today", async () => {
    const database = db();
    await expect(retireExpired(database as never, MORNING)).resolves.toEqual({ discounts: 2, subsidies: 1 });

    const discounts = database.discount.updateMany.mock.calls[0][0];
    expect(discounts.where.status).toBe("active");
    expect(discounts.data).toEqual({ status: "inactive" });
    // Compared against the start of today, so one valid to today survives.
    expect(discounts.where.validTo).toEqual({ lt: new Date("2026-11-03T00:00:00.000Z") });

    const subsidies = database.subsidy.updateMany.mock.calls[0][0];
    expect(subsidies.where.to).toEqual({ lt: new Date("2026-11-03T00:00:00.000Z") });
  });

  it("counts the day by Rwanda's clock, not the server's", async () => {
    // 23:30 UTC is already half past one in the morning here, so the day the
    // sweep works to is the 4th.
    const database = db();
    await retireExpired(database as never, new Date("2026-11-03T23:30:00Z"));
    expect(database.discount.updateMany.mock.calls[0][0].where.validTo)
      .toEqual({ lt: new Date("2026-11-04T00:00:00.000Z") });
  });

  it("never touches one that is already inactive, or one still to come", async () => {
    // Only `status: "active"` and a last day in the past are matched; a rate
    // waiting to start is active on purpose, and its dates keep it out of
    // every sale until it begins.
    const database = db();
    await retireExpired(database as never, MORNING);
    for (const call of [database.discount.updateMany, database.subsidy.updateMany]) {
      const { where } = call.mock.calls[0][0];
      expect(where.status).toBe("active");
      expect(Object.keys(where)).toHaveLength(2);
    }
  });

  it("says nothing changed when nothing had run out", async () => {
    await expect(retireExpired(db({ discounts: 0, subsidies: 0 }) as never, MORNING))
      .resolves.toEqual({ discounts: 0, subsidies: 0 });
  });
});
