import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/shared/auth/context-user.js";
import { addDays, businessToday, DashboardService } from "../src/modules/dashboard/dashboard.service.js";

const actor = (position: AuthUser["position"], siteId: string | null): AuthUser => ({
  userId: "user-id", position, roleId: "role-id", role: "Role", permissions: [], siteId, clientId: null,
});

function setup() {
  const repo = {
    dailySales: vi.fn().mockResolvedValue([]),
    sites: vi.fn().mockResolvedValue([]),
    items: vi.fn().mockResolvedValue([]),
  };
  return { repo, service: new DashboardService(repo as never) };
}

describe("dashboard days", () => {
  it("counts the business day in Rwanda time", () => {
    expect(businessToday(new Date("2026-10-12T21:59:00Z"))).toBe("2026-10-12");
    expect(businessToday(new Date("2026-10-12T22:00:00Z"))).toBe("2026-10-13");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("runs from 1 January to yesterday, and compares the month with the same days of the last", async () => {
    const { repo, service } = setup();
    const result = await service.summary({}, actor("superAdmin", null), new Date("2026-10-13T13:25:00Z"));
    expect(result.period).toMatchObject({ startDate: "2026-01-01", endDate: "2026-10-12", excludesToday: true });
    expect(result.summary.month.previousPeriod).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-12" });
    expect(repo.dailySales).toHaveBeenCalledWith("2026-01-01", "2026-10-12", undefined);
  });

  it("stops the previous month at its last day", async () => {
    const { service } = setup();
    // Yesterday was 31 March, so the month before ends on 28 February.
    const result = await service.summary({}, actor("superAdmin", null), new Date("2026-04-01T10:00:00Z"));
    expect(result.summary.month.previousPeriod).toMatchObject({ startDate: "2026-02-01", endDate: "2026-02-28" });
  });

  it("reaches back into December when the year has only just started", async () => {
    const { repo, service } = setup();
    const result = await service.summary({}, actor("superAdmin", null), new Date("2027-01-05T10:00:00Z"));
    expect(result.period).toMatchObject({ startDate: "2027-01-01", endDate: "2027-01-04" });
    expect(repo.dailySales).toHaveBeenCalledWith("2026-12-01", "2027-01-04", undefined);
  });
});

describe("dashboard access", () => {
  it("holds site staff to their own site", async () => {
    const { repo, service } = setup();
    await service.summary({}, actor("siteManager", "own-site"), new Date("2026-10-13T10:00:00Z"));
    expect(repo.dailySales).toHaveBeenCalledWith(expect.any(String), expect.any(String), "own-site");
    expect(repo.sites).toHaveBeenCalledWith("own-site");
  });

  it("refuses client users", async () => {
    const { service } = setup();
    await expect(service.summary({}, actor("clientAdmin", null))).rejects.toMatchObject({ statusCode: 403 });
  });
});
