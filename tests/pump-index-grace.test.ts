import { describe, expect, it, vi } from "vitest";
import { rosteredNow } from "../src/modules/mobile/transactions/sale-rules.js";

const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const SHIFTS = {
  morning: { name: "Morning", startAt: time("06:00"), endAt: time("14:00") },
  night: { name: "Night", startAt: time("22:00"), endAt: time("06:00") },
};

/**
 * The roster, as the time table holds it. Rwanda is UTC+2, so a clock given
 * here as `08:00Z` is 10:00 on the forecourt.
 */
function db(roster: Array<{ date: string; shift: keyof typeof SHIFTS }>) {
  return {
    tblTimeTable: {
      findMany: vi.fn().mockResolvedValue(
        roster.map((row) => ({
          id: `${row.date}|${row.shift}`,
          dateOn: new Date(`${row.date}T00:00:00.000Z`),
          siteShiftId: row.shift,
          shiftSite: { shift: SHIFTS[row.shift] },
        })),
      ),
    },
  };
}

const working = async (
  roster: Array<{ date: string; shift: keyof typeof SHIFTS }>,
  now: string,
  graceMinutes = 0,
) => (await rosteredNow(db(roster) as never, "user", "site", new Date(now), graceMinutes))
  .working.map((row) => row.siteShiftId);

const MONDAY = [{ date: "2026-11-02", shift: "morning" as const }];

describe("the shift an attendant is working now", () => {
  it("is the one whose hours cover the clock, with no grace", async () => {
    // 08:00Z is 10:00 local, inside 06:00–14:00.
    await expect(working(MONDAY, "2026-11-02T08:00:00Z")).resolves.toEqual(["morning"]);
    // 12:30Z is 14:30 local: the shift is over, and a sale may not be confirmed.
    await expect(working(MONDAY, "2026-11-02T12:30:00Z")).resolves.toEqual([]);
  });

  it("stays open through the grace after its hours, for the counters", async () => {
    // Closing up at 14:30 and 15:59 local still counts with two hours' grace…
    await expect(working(MONDAY, "2026-11-02T12:30:00Z", 120)).resolves.toEqual(["morning"]);
    await expect(working(MONDAY, "2026-11-02T13:59:00Z", 120)).resolves.toEqual(["morning"]);
    // …and 16:30 local does not: the grace has run out.
    await expect(working(MONDAY, "2026-11-02T14:30:00Z", 120)).resolves.toEqual([]);
  });

  it("does not let the grace reach backwards into a shift not yet started", async () => {
    // 05:00 local, an hour before the morning shift opens.
    await expect(working(MONDAY, "2026-11-02T03:00:00Z", 120)).resolves.toEqual([]);
  });

  it("gives both shifts at a handover, so the POS says which it is closing", async () => {
    const roster = [
      { date: "2026-11-02", shift: "morning" as const },
      { date: "2026-11-02", shift: "night" as const },
    ];
    // 21:00Z is 23:00 local: the night shift has begun; the morning one ended
    // nine hours ago and is long out of its grace.
    await expect(working(roster, "2026-11-02T21:00:00Z", 120)).resolves.toEqual(["night"]);
  });

  it("keeps a night shift on the date it started, grace or not", async () => {
    const roster = [{ date: "2026-11-02", shift: "night" as const }];
    // 23:00 local on its own date, and 03:00 the next morning: both Monday's.
    await expect(working(roster, "2026-11-02T21:00:00Z")).resolves.toEqual(["night"]);
    await expect(working(roster, "2026-11-03T01:00:00Z")).resolves.toEqual(["night"]);
    // 07:00 local is past its 06:00 end, and only the grace holds it.
    await expect(working(roster, "2026-11-03T05:00:00Z")).resolves.toEqual([]);
    await expect(working(roster, "2026-11-03T05:00:00Z", 120)).resolves.toEqual(["night"]);
  });

  it("carries a late shift's grace past midnight, and no further", async () => {
    // A shift ending at 23:30 with two hours' grace is still open at 00:30 the
    // next morning — the roster row it belongs to is the previous day's.
    const late = { name: "Late", startAt: time("15:30"), endAt: time("23:30") };
    const database = {
      tblTimeTable: {
        findMany: vi.fn().mockResolvedValue([{
          id: "late", dateOn: new Date("2026-11-02T00:00:00.000Z"),
          siteShiftId: "late", shiftSite: { shift: late },
        }]),
      },
    };
    // 00:30 local on the 3rd.
    const inGrace = await rosteredNow(database as never, "user", "site", new Date("2026-11-02T22:30:00Z"), 120);
    expect(inGrace.working.map((row) => row.siteShiftId)).toEqual(["late"]);
    // 02:30 local: the grace has run out.
    const after = await rosteredNow(database as never, "user", "site", new Date("2026-11-03T00:30:00Z"), 120);
    expect(after.working).toEqual([]);
  });

  it("never returns someone marked absent: the query asks for it", async () => {
    const database = db(MONDAY);
    await rosteredNow(database as never, "user", "site", new Date("2026-11-02T08:00:00Z"));
    expect(database.tblTimeTable.findMany.mock.calls[0][0].where.status).toEqual({ not: 2 });
  });
});
