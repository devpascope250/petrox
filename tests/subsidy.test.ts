import { describe, expect, it, vi } from "vitest";
import { SubsidyRepository } from "../src/modules/subsidies/subsidy.repository.js";
import { createSubsidySchema, subsidyListQuerySchema } from "../src/modules/subsidies/subsidy.schema.js";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const SITE = "123e4567-e89b-42d3-a456-426614174001";
const SUBSIDY = "123e4567-e89b-42d3-a456-426614174002";
const USER = "123e4567-e89b-42d3-a456-426614174003";

const body = { itemId: ITEM, rate: 150, from: "2026-10-01", to: "2026-12-31" };

describe("subsidy input validation", () => {
  it("accepts a rate with two decimals and a site", () => {
    const parsed = createSubsidySchema.safeParse({ ...body, rate: "150.25", siteId: SITE });
    expect(parsed.success).toBe(true);
    // A subsidy with no site applies at every site, so it is optional.
    expect(createSubsidySchema.safeParse(body).success).toBe(true);
  });

  it("defaults a new subsidy to active", () => {
    const parsed = createSubsidySchema.parse(body);
    expect(parsed.status).toBe("active");
  });

  it("refuses a rate of zero, a negative one, or more than two decimals", () => {
    for (const rate of [0, -5, "150.255"]) {
      expect(createSubsidySchema.safeParse({ ...body, rate }).success).toBe(false);
    }
  });

  it("refuses a period that ends before it starts", () => {
    const parsed = createSubsidySchema.safeParse({ ...body, from: "2026-12-31", to: "2026-10-01" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["to"]);
  });

  it("accepts a period of a single day", () => {
    expect(createSubsidySchema.safeParse({ ...body, from: "2026-10-01", to: "2026-10-01" }).success).toBe(true);
  });

  it("refuses an unknown field rather than ignoring it", () => {
    expect(createSubsidySchema.safeParse({ ...body, percent: 5 }).success).toBe(false);
  });

  it("takes 'none' as the site filter, for subsidies that apply everywhere", () => {
    expect(subsidyListQuerySchema.parse({ siteId: "none" }).siteId).toBe("none");
    expect(subsidyListQuerySchema.safeParse({ siteId: "every-site" }).success).toBe(false);
  });
});

/**
 * A transaction that records which rows were retired, so the one-active rule
 * can be checked without a database.
 */
function db({ status = "active" as "active" | "inactive" } = {}) {
  const tx = {
    subsidy: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({
        id: SUBSIDY, itemId: ITEM, siteId: null, rate: "150", status,
        from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-12-31T00:00:00.000Z"),
        note: null, createdBy: USER, createdAt: new Date(), updated: new Date(),
        item: { id: ITEM, name: "Petrol", baseUnit: null }, site: null, user: null,
      }),
      update: vi.fn().mockResolvedValue({
        id: SUBSIDY, itemId: ITEM, siteId: null, rate: "150", status,
        from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-12-31T00:00:00.000Z"),
        note: null, createdBy: USER, createdAt: new Date(), updated: new Date(),
        item: { id: ITEM, name: "Petrol", baseUnit: null }, site: null, user: null,
      }),
    },
  };
  return {
    tx,
    repo: new SubsidyRepository({
      $transaction: (run: (tx: unknown) => unknown) => run(tx),
    } as never),
  };
}

describe("one active subsidy per product", () => {
  it("retires the product's active subsidy when a new active one is recorded", async () => {
    const { tx, repo } = db();
    const created = await repo.create(createSubsidySchema.parse(body), USER);
    expect(tx.subsidy.updateMany).toHaveBeenCalledWith({
      where: { itemId: ITEM, status: "active" },
      data: { status: "inactive" },
    });
    // The answer says what it replaced, so a screen need not guess.
    expect(created.replaced).toBe(1);
  });

  it("leaves the active one alone when the new subsidy is recorded inactive", async () => {
    const { tx, repo } = db({ status: "inactive" });
    const created = await repo.create(createSubsidySchema.parse({ ...body, status: "inactive" }), USER);
    expect(tx.subsidy.updateMany).not.toHaveBeenCalled();
    expect(created.replaced).toBe(0);
  });

  it("retires the others when a subsidy is switched on, never itself", async () => {
    const { tx, repo } = db();
    await repo.changeStatus(SUBSIDY, ITEM, "active");
    expect(tx.subsidy.updateMany).toHaveBeenCalledWith({
      where: { itemId: ITEM, status: "active", id: { not: SUBSIDY } },
      data: { status: "inactive" },
    });
  });

  it("retires nothing when a subsidy is switched off", async () => {
    const { tx, repo } = db({ status: "inactive" });
    await repo.changeStatus(SUBSIDY, ITEM, "inactive");
    expect(tx.subsidy.updateMany).not.toHaveBeenCalled();
  });

  it("retires on the product an active subsidy is moved to", async () => {
    const { tx, repo } = db();
    const moved = "123e4567-e89b-42d3-a456-426614174009";
    await repo.update(SUBSIDY, createSubsidySchema.parse({ ...body, itemId: moved }));
    expect(tx.subsidy.updateMany).toHaveBeenCalledWith({
      where: { itemId: moved, status: "active", id: { not: SUBSIDY } },
      data: { status: "inactive" },
    });
  });

  it("returns the days as they are stored, not shifted into local time", async () => {
    const { repo } = db();
    const created = await repo.create(createSubsidySchema.parse(body), USER);
    expect(created.from).toBe("2026-10-01");
    expect(created.to).toBe("2026-12-31");
    expect(created.rate).toBe(150);
  });
});
