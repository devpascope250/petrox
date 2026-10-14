import { describe, expect, it, vi } from "vitest";
import { MobileTransactionsRepository } from "../src/modules/mobile/transactions/transactions.repository.js";

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const SHIFTS = {
  morning: { name: "Morning", startAt: time("06:00"), endAt: time("14:00") },
  night: { name: "Night", startAt: time("22:00"), endAt: time("06:00") },
};
const nozzle = { id: "nozzle-1", name: "Nozzle1", pump: { id: "pump-1", name: "PUMP1" } };

/** The rota rows the database would return for the attendant on that pump. */
function check(rows: Array<{ day: number; shift: keyof typeof SHIFTS; nozzles?: string[] }>, now: string) {
  const db = { tblPumpAttendant: { findMany: vi.fn().mockResolvedValue(rows.map((row) => ({
    day: row.day, siteShiftId: `${row.shift}-${row.day}`,
    siteShift: { shift: SHIFTS[row.shift] },
    pumpAttendantNozzles: (row.nozzles ?? ["nozzle-1"]).map((nozzleId) => ({ nozzleId })),
  }))) } };
  const repo = new MobileTransactionsRepository(db as never, "secret");
  // Private: the rule is tested on its own, with the clock fixed.
  return (repo as unknown as { pumpAssignment: (...args: unknown[]) => Promise<string> })
    .pumpAssignment(db, "user", "site", nozzle, new Date(now));
}

describe("pump rota when confirming a sale", () => {
  // 14 Oct 2026 is a Wednesday (day 3); Rwanda is UTC+2.
  it("finds the shift running now on today's weekday", async () => {
    await expect(check([{ day: 3, shift: "morning" }], "2026-10-14T08:00:00Z")).resolves.toBe("morning-3");
  });

  it("refuses outside the shift's hours or on another weekday", async () => {
    await expect(check([{ day: 3, shift: "morning" }], "2026-10-14T13:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_PUMP" });
    await expect(check([{ day: 4, shift: "morning" }], "2026-10-14T08:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_PUMP" });
  });

  it("refuses a nozzle that is not the attendant's", async () => {
    await expect(check([{ day: 3, shift: "morning", nozzles: ["nozzle-2"] }], "2026-10-14T08:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_NOZZLE" });
  });

  it("keeps a night shift on the weekday it started, past midnight", async () => {
    // Tuesday's night shift: Tuesday 23:00 and Wednesday 03:00, but not Wednesday 23:00.
    await expect(check([{ day: 2, shift: "night" }], "2026-10-13T21:00:00Z")).resolves.toBe("night-2");
    await expect(check([{ day: 2, shift: "night" }], "2026-10-14T01:00:00Z")).resolves.toBe("night-2");
    await expect(check([{ day: 2, shift: "night" }], "2026-10-14T21:00:00Z"))
      .rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_PUMP" });
  });

  it("wraps Monday's small hours back to Sunday's night shift", async () => {
    // 19 Oct 2026 is a Monday; 02:00 there is still Sunday's (day 7) night shift.
    await expect(check([{ day: 7, shift: "night" }], "2026-10-19T00:00:00Z")).resolves.toBe("night-7");
  });
});
