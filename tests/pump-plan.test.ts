import { describe, expect, it, vi } from "vitest";
import { applyPlans } from "../src/modules/shifts/pump-plan-apply.js";

/** A roster row as the time table writes one: person, shift, weekday. */
const monday = { id: "roster-mon", userId: "jean", siteShiftId: "shift-1", days: 1 };

/**
 * A transaction that answers with the plans given, and records the pump
 * assignments it is asked to write.
 */
function txWith(options: {
  plans?: Array<{ id: string; pumpId: string; nozzleIds: string[]; userId?: string; siteShiftId?: string; weekday?: number }>;
  /** Pumps the day already carries. */
  onDay?: string[];
} = {}) {
  const written: Array<Record<string, unknown>> = [];
  const tx = {
    pumpAttendantPlan: {
      findMany: vi.fn().mockResolvedValue((options.plans ?? []).map((plan) => ({
        id: plan.id, pumpId: plan.pumpId,
        userId: plan.userId ?? "jean", siteShiftId: plan.siteShiftId ?? "shift-1", weekday: plan.weekday ?? 1,
        nozzles: plan.nozzleIds.map((nozzleId) => ({ nozzleId })),
      }))),
    },
    tblPumpAttendant: {
      findFirst: vi.fn().mockImplementation(async ({ where }) =>
        (options.onDay ?? []).includes(where.pumpId as string) ? { id: "already" } : null),
      create: vi.fn().mockImplementation(async ({ data }) => {
        written.push(data);
        return { id: `written-${written.length}` };
      }),
    },
  };
  return { tx, written };
}

describe("rostering someone puts them on their pump", () => {
  it("writes the weekday plan's pump and nozzles for the day just rostered", async () => {
    const { tx, written } = txWith({ plans: [{ id: "plan-mon", pumpId: "pump-a", nozzleIds: ["n1", "n2"] }] });
    await expect(applyPlans(tx as never, [monday])).resolves.toBe(1);
    expect(written[0]).toMatchObject({ timeTableId: "roster-mon", pumpId: "pump-a", fromPlanId: "plan-mon" });
    expect(written[0].pumpAttendantNozzles).toEqual({ create: [{ nozzleId: "n1" }, { nozzleId: "n2" }] });
  });

  it("asks only for plans that fit the person, the shift and the weekday", async () => {
    const { tx } = txWith({ plans: [] });
    await applyPlans(tx as never, [monday]);
    const { where } = tx.pumpAttendantPlan.findMany.mock.calls[0][0];
    expect(where.status).toBe("active");
    expect(where.OR).toEqual([{ userId: "jean", siteShiftId: "shift-1", weekday: 1 }]);
  });

  it("writes nothing when no plan covers that weekday", async () => {
    const { tx, written } = txWith({ plans: [] });
    await expect(applyPlans(tx as never, [monday])).resolves.toBe(0);
    expect(written).toHaveLength(0);
  });

  it("leaves a day that already carries that pump alone", async () => {
    // Rostering twice, or copying a week onto days already filled, must not
    // double up: the assignment is already there.
    const { tx, written } = txWith({
      plans: [{ id: "plan-mon", pumpId: "pump-a", nozzleIds: ["n1"] }],
      onDay: ["pump-a"],
    });
    await expect(applyPlans(tx as never, [monday])).resolves.toBe(0);
    expect(written).toHaveLength(0);
  });

  it("writes every plan the day matches, for someone on two pumps", async () => {
    const { tx, written } = txWith({
      plans: [
        { id: "plan-a", pumpId: "pump-a", nozzleIds: ["n1"] },
        { id: "plan-b", pumpId: "pump-b", nozzleIds: ["n3"] },
      ],
    });
    await expect(applyPlans(tx as never, [monday])).resolves.toBe(2);
    expect(written.map((row) => row.pumpId)).toEqual(["pump-a", "pump-b"]);
  });

  it("gives each rostered day its own plan, and none to a day with no plan", async () => {
    // Tuesday is rostered as well, but only Monday has an arrangement.
    const tuesday = { id: "roster-tue", userId: "jean", siteShiftId: "shift-1", days: 2 };
    const { tx, written } = txWith({ plans: [{ id: "plan-mon", pumpId: "pump-a", nozzleIds: ["n1"] }] });
    await expect(applyPlans(tx as never, [monday, tuesday])).resolves.toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0].timeTableId).toBe("roster-mon");
  });

  it("does not go to the database at all when nobody was rostered", async () => {
    const { tx } = txWith();
    await expect(applyPlans(tx as never, [])).resolves.toBe(0);
    expect(tx.pumpAttendantPlan.findMany).not.toHaveBeenCalled();
  });
});
