import { describe, expect, it, vi } from "vitest";
import { MobileTransactionsRepository } from "../src/modules/mobile/transactions/transactions.repository.js";

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const SHIFTS = {
  morning: { name: "Morning", startAt: time("06:00"), endAt: time("14:00") },
  night: { name: "Night", startAt: time("22:00"), endAt: time("06:00") },
};
const nozzle = { id: "nozzle-1", name: "Nozzle1", pump: { id: "pump-1", name: "PUMP1" } };

/**
 * The time table rosters the attendant onto shifts by date; the pump rota says
 * which nozzles he handles in a shift, with no date of its own.
 */
function check(
  roster: Array<{ date: string; shift: keyof typeof SHIFTS }>,
  now: string,
  rota: Array<{ shift: keyof typeof SHIFTS; nozzles?: string[] }> = [{ shift: "morning" }, { shift: "night" }],
) {
  const db = {
    tblTimeTable: {
      findMany: vi.fn().mockResolvedValue(
        roster.map((row) => ({
          dateOn: new Date(`${row.date}T00:00:00.000Z`),
          siteShiftId: row.shift,
          shiftSite: { shift: SHIFTS[row.shift] },
        })),
      ),
    },
    tblPumpAttendant: {
      findMany: vi.fn().mockImplementation(async ({ where }) =>
        rota
          .filter((row) => (where.siteShiftId.in as string[]).includes(row.shift))
          .map((row) => ({
            siteShiftId: row.shift,
            pumpAttendantNozzles: (row.nozzles ?? ["nozzle-1"]).map((nozzleId) => ({ nozzleId })),
          })),
      ),
    },
  };
  const repo = new MobileTransactionsRepository(db as never, "secret");
  // Private: the rule is tested on its own, with the clock fixed.
  return (repo as unknown as { pumpAssignment: (...args: unknown[]) => Promise<{ siteShiftId: string; workingDay: string }> })
    .pumpAssignment(db, "user", "site", nozzle, new Date(now));
}

describe("the shift an attendant is working when a sale is confirmed", () => {
  // Rwanda is UTC+2, so 08:00Z is 10:00 local.
  it("takes the shift and the working day from the time table", async () => {
    await expect(check([{ date: "2026-10-14", shift: "morning" }], "2026-10-14T08:00:00Z"))
      .resolves.toMatchObject({ siteShiftId: "morning", workingDay: "2026-10-14" });
  });

  it("refuses an attendant the time table does not put on a shift running now", async () => {
    // Rostered, but the morning shift is over.
    await expect(check([{ date: "2026-10-14", shift: "morning" }], "2026-10-14T13:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
    // Rostered on another date.
    await expect(check([{ date: "2026-10-15", shift: "morning" }], "2026-10-14T08:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
    // Not rostered at all — the rota alone no longer lets him sell.
    await expect(check([], "2026-10-14T08:00:00Z")).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
  });

  it("refuses a pump or a nozzle that is not the attendant's, though he is on the shift", async () => {
    await expect(check([{ date: "2026-10-14", shift: "morning" }], "2026-10-14T08:00:00Z", []))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_PUMP" });
    await expect(check([{ date: "2026-10-14", shift: "morning" }], "2026-10-14T08:00:00Z", [{ shift: "morning", nozzles: ["nozzle-2"] }]))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_NOZZLE" });
  });

  it("keeps a night shift on the date it started, past midnight", async () => {
    const roster = [{ date: "2026-10-13", shift: "night" as const }];
    // Tuesday 23:00 local, and 03:00 on Wednesday: both Tuesday's shift.
    await expect(check(roster, "2026-10-13T21:00:00Z")).resolves.toMatchObject({ siteShiftId: "night", workingDay: "2026-10-13" });
    await expect(check(roster, "2026-10-14T01:00:00Z")).resolves.toMatchObject({ siteShiftId: "night", workingDay: "2026-10-13" });
    // Wednesday 23:00 belongs to Wednesday's shift, which he is not rostered on.
    await expect(check(roster, "2026-10-14T21:00:00Z")).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
  });

  it("marks an absent attendant as not rostered", async () => {
    // Absent rows never come back: the query asks for status other than 2.
    const db = {
      tblTimeTable: { findMany: vi.fn().mockResolvedValue([]) },
      tblPumpAttendant: { findMany: vi.fn() },
    };
    const repo = new MobileTransactionsRepository(db as never, "secret");
    await expect(
      (repo as unknown as { pumpAssignment: (...args: unknown[]) => Promise<unknown> })
        .pumpAssignment(db, "user", "site", nozzle, new Date("2026-10-14T08:00:00Z")),
    ).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
    expect(db.tblTimeTable.findMany.mock.calls[0][0].where.status).toEqual({ not: 2 });
    expect(db.tblPumpAttendant.findMany).not.toHaveBeenCalled();
  });
});
