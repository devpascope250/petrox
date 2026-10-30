import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { PumpIndexService } from "../src/modules/pump-indexes/pump-index.service.js";
import type { AuthUser } from "../src/shared/auth/context-user.js";

const decimal = (value: number | string) => new Prisma.Decimal(value);
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const actor = (position: AuthUser["position"] = "superAdmin", siteId: string | null = null): AuthUser => ({
  userId: "user-1", position, roleId: "role-1", role: "Role", permissions: [], siteId, clientId: null,
});

const NOZZLE = {
  id: "nozzle-1", name: "N1", nozzleCode: "N1", status: "active",
  pump: { id: "pump-1", name: "PUMP1", siteId: "site-1", status: "active" },
  cuve: { id: "cuve-1", name: "Tank", item: { id: "item-1", name: "AGO", status: "active", baseUnitId: "unit-1" } },
};

/** A repository that answers what each test needs, and records what it was asked to write. */
function repoWith(options: {
  previous?: { id: string; dateOn: Date; endIndex: Prisma.Decimal; confirmedBy: string | null } | null;
  later?: { id: string; dateOn: Date; createdAt: Date } | null;
  /** `null` for "no such reading"; left out means an ordinary unapproved one. */
  reading?: Partial<{ id: string; nozzleId: string; dateOn: Date; startIndex: Prisma.Decimal;
    endIndex: Prisma.Decimal; confirmedBy: string | null; siteId: string;
    shiftSiteId: string; attendantId: string }> | null;
  /** `null` for an attendant the time table does not put on that shift. */
  rostered?: { user: { id: string; firstName: string; lastName: string } } | null;
  /** The pumps and nozzles the rota gives them in that shift. */
  rota?: Array<{ pump: { id: string; name: string }; nozzleIds: string[] }>;
  price?: Prisma.Decimal;
} = {}) {
  const written: Array<Record<string, unknown>> = [];
  return {
    written,
    repo: {
      nozzleFor: vi.fn().mockResolvedValue(NOZZLE),
      rosteredOn: vi.fn().mockResolvedValue(
        options.rostered === undefined
          ? { id: 'roster-1', status: 1, isChief: false, isSuport: false, extraShift: 0,
              user: { id: 'attendant-1', firstName: 'Jean', lastName: 'Uwase' } }
          : options.rostered,
      ),
      rotaFor: vi.fn().mockResolvedValue(
        (options.rota ?? [{ pump: { id: 'pump-1', name: 'PUMP1' }, nozzleIds: ['nozzle-1'] }])
          .map((row) => ({
            id: `rota-${row.pump.id}`,
            pump: { ...row.pump, siteId: 'site-1', status: 'active' },
            pumpAttendantNozzles: row.nozzleIds.map((id) => ({ nozzle: { id, name: id } })),
          })),
      ),
      shiftFor: vi.fn().mockResolvedValue({ id: "shift-1", status: 1, shift: { name: "Morning" } }),
      latestFor: vi.fn().mockResolvedValue(options.previous ?? null),
      hasLaterThan: vi.fn().mockResolvedValue(options.later ?? null),
      priceFor: vi.fn().mockResolvedValue(options.price ?? decimal(1764)),
      findForWrite: vi.fn().mockResolvedValue(options.reading === null ? null : {
        id: "reading-1", nozzleId: "nozzle-1", dateOn: day("2026-10-30"),
        startIndex: decimal(1000), endIndex: decimal(1100), confirmedBy: null, siteId: "site-1",
        shiftSiteId: "shift-1", attendantId: "attendant-1",
        ...options.reading,
      }),
      create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
        written.push(data);
        return row({ startIndex: data.startIndex as Prisma.Decimal, endIndex: data.endIndex as Prisma.Decimal,
          sellingPrice: data.sellingPrice as Prisma.Decimal });
      }),
      update: vi.fn().mockImplementation(async (_id: string, data: Record<string, unknown>) => {
        written.push(data);
        return row({});
      }),
      approve: vi.fn().mockImplementation(async () => row({ confirmedBy: "user-1", confirmedAt: new Date() })),
    },
  };
}

/** A stored reading, as the select returns one. */
function row(over: Partial<{ startIndex: Prisma.Decimal; endIndex: Prisma.Decimal; sellingPrice: Prisma.Decimal;
  confirmedBy: string | null; confirmedAt: Date | null }>) {
  return {
    id: "reading-1", dateOn: day("2026-10-30"),
    startIndex: over.startIndex ?? decimal(1000), endIndex: over.endIndex ?? decimal(1100),
    sellingPrice: over.sellingPrice ?? decimal(1764),
    confirmedBy: over.confirmedBy ?? null, confirmedAt: over.confirmedAt ?? null, createdAt: new Date(),
    pump: { id: "pump-1", name: "PUMP1" },
    nozzle: { id: "nozzle-1", name: "N1", nozzleCode: "N1" },
    item: { id: "item-1", name: "AGO", baseUnit: { id: "unit-1", name: "Litre", code: "L" } },
    site: { id: "site-1", name: "Station" },
    shiftSite: { id: "shift-1", shift: { id: "s", name: "Morning",
      startAt: new Date("1970-01-01T06:00:00.000Z"), endAt: new Date("1970-01-01T14:00:00.000Z") } },
    user: { id: "user-1", firstName: "A", lastName: "B" },
    confirmedUser: null,
    attendantId: "attendant-1",
    attendant: { id: "attendant-1", firstName: "Jean", lastName: "Uwase", phone: null },
  };
}

const input = {
  nozzleId: "nozzle-1", shiftSiteId: "shift-1", dateOn: "2026-10-30",
  attendantId: "attendant-1", endIndex: "1200",
};

describe("the chain a nozzle's readings make", () => {
  it("opens the first reading on a nozzle at the figure typed", async () => {
    const { repo, written } = repoWith({ previous: null });
    const service = new PumpIndexService(repo as never);
    const reading = await service.create({ ...input, startIndex: "12480.50", endIndex: "12910.50" }, actor());
    expect(written[0].startIndex).toEqual(decimal("12480.50"));
    // 430 litres through the nozzle over the shift.
    expect(reading.quantity).toBeCloseTo(430);
  });

  it("opens the first reading at zero when no figure is typed", async () => {
    const { repo, written } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).create(input, actor());
    expect(written[0].startIndex).toEqual(decimal(0));
  });

  it("carries the opening figure from the reading before it", async () => {
    const previous = { id: "older", dateOn: day("2026-10-29"), endIndex: decimal("12910.50"), confirmedBy: "user-9" };
    const { repo, written } = repoWith({ previous });
    await new PumpIndexService(repo as never).create({ ...input, endIndex: "13402" }, actor());
    expect(written[0].startIndex).toEqual(decimal("12910.50"));
    expect(written[0].endIndex).toEqual(decimal("13402"));
  });

  it("refuses an opening figure sent for anything but the first reading", async () => {
    const previous = { id: "older", dateOn: day("2026-10-29"), endIndex: decimal(500), confirmedBy: null };
    const service = new PumpIndexService(repoWith({ previous }).repo as never);
    await expect(service.create({ ...input, startIndex: "999" }, actor()))
      .rejects.toMatchObject({ code: "START_INDEX_IS_CARRIED" });
  });

  it("refuses a reading for a day before the last one on the nozzle", async () => {
    const previous = { id: "older", dateOn: day("2026-10-30"), endIndex: decimal(500), confirmedBy: null };
    const service = new PumpIndexService(repoWith({ previous }).repo as never);
    await expect(service.create({ ...input, dateOn: "2026-10-28", endIndex: "600" }, actor()))
      .rejects.toMatchObject({ code: "READING_OUT_OF_ORDER" });
  });

  it("refuses a closing figure below the opening one: a counter does not run backwards", async () => {
    const previous = { id: "older", dateOn: day("2026-10-29"), endIndex: decimal(900), confirmedBy: null };
    const service = new PumpIndexService(repoWith({ previous }).repo as never);
    await expect(service.create({ ...input, endIndex: "800" }, actor()))
      .rejects.toMatchObject({ code: "INDEX_GOES_BACKWARDS" });
  });
});

describe("the price a reading records", () => {
  it("snapshots the price in force when the form sends none", async () => {
    const { repo, written } = repoWith({ previous: null, price: decimal(1800) });
    await new PumpIndexService(repo as never).create(input, actor());
    expect(written[0].sellingPrice).toEqual(decimal(1800));
  });

  it("keeps the price typed, for a shift that sold at another one", async () => {
    const { repo, written } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).create({ ...input, sellingPrice: "1700" }, actor());
    expect(written[0].sellingPrice).toEqual(decimal(1700));
  });
});

describe("what may still be changed", () => {
  it("refuses to edit an approved reading", async () => {
    const service = new PumpIndexService(repoWith({ reading: { confirmedBy: "user-9" } }).repo as never);
    await expect(service.update("reading-1", { endIndex: "1300" }, actor()))
      .rejects.toMatchObject({ code: "READING_APPROVED" });
  });

  it("refuses to edit one whose chain already continues", async () => {
    const later = { id: "newer", dateOn: day("2026-10-31"), createdAt: new Date() };
    const service = new PumpIndexService(repoWith({ later }).repo as never);
    await expect(service.update("reading-1", { endIndex: "1300" }, actor()))
      .rejects.toMatchObject({ code: "CHAIN_CONTINUES" });
  });

  it("edits the last unapproved reading on a nozzle", async () => {
    const { repo, written } = repoWith({ previous: null });
    const service = new PumpIndexService(repo as never);
    await service.update("reading-1", { endIndex: "1300" }, actor());
    expect(written[0]).toMatchObject({ endIndex: decimal(1300) });
  });

  it("still refuses a closing figure below the opening one when editing", async () => {
    const service = new PumpIndexService(repoWith({ previous: null }).repo as never);
    await expect(service.update("reading-1", { endIndex: "900" }, actor()))
      .rejects.toMatchObject({ code: "INDEX_GOES_BACKWARDS" });
  });

  it("has no delete at all: a reading is part of a chain", () => {
    const service = new PumpIndexService(repoWith().repo as never) as unknown as Record<string, unknown>;
    expect(service.delete).toBeUndefined();
    expect(service.remove).toBeUndefined();
  });
});

describe("who may read and record", () => {
  it("holds site staff to their own site", async () => {
    const { repo } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).create(input, actor("siteManager", "own-site"));
    expect(repo.nozzleFor).toHaveBeenCalledWith("nozzle-1", "own-site");
  });

  it("lets a super administrator reach every site", async () => {
    const { repo } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).create(input, actor("superAdmin", null));
    expect(repo.nozzleFor).toHaveBeenCalledWith("nozzle-1", undefined);
  });

  it("refuses a client user, and site staff with no site", async () => {
    const service = new PumpIndexService(repoWith().repo as never);
    await expect(service.create(input, actor("clientAdmin", null)))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(service.create(input, actor("siteManager", null)))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("whose shift the reading is for", () => {
  it("records the attendant the time table and the rota agree was there", async () => {
    const { repo, written } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).create(input, actor());
    expect(repo.rosteredOn).toHaveBeenCalledWith("attendant-1", "shift-1", "2026-10-30");
    expect(written[0].attendantId).toBe("attendant-1");
  });

  it("refuses an attendant the time table does not put on that shift that day", async () => {
    // The roster is the authority on when someone works, so a rota entry alone
    // is not enough — exactly as the POS refuses the sale.
    const service = new PumpIndexService(repoWith({ previous: null, rostered: null }).repo as never);
    await expect(service.create(input, actor())).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_SHIFT" });
  });

  it("refuses a pump, or a nozzle, that is not theirs in that shift", async () => {
    const otherPump = new PumpIndexService(repoWith({ previous: null,
      rota: [{ pump: { id: "pump-9", name: "PUMP9" }, nozzleIds: ["nozzle-9"] }] }).repo as never);
    await expect(otherPump.create(input, actor())).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_PUMP" });

    const otherNozzle = new PumpIndexService(repoWith({ previous: null,
      rota: [{ pump: { id: "pump-1", name: "PUMP1" }, nozzleIds: ["nozzle-2"] }] }).repo as never);
    await expect(otherNozzle.create(input, actor())).rejects.toMatchObject({ code: "ATTENDANT_NOT_ON_NOZZLE" });
  });

  it("checks the roster again when a correction moves the shift, the day or the attendant", async () => {
    const { repo } = repoWith({ previous: null });
    const service = new PumpIndexService(repo as never);
    await service.update("reading-1", { attendantId: "attendant-2" }, actor());
    // The whole of it, not just the part that moved: the reading's own shift
    // and day go with the new attendant.
    expect(repo.rosteredOn).toHaveBeenCalledWith("attendant-2", "shift-1", "2026-10-30");
  });

  it("leaves the roster alone for a correction that only changes a figure", async () => {
    const { repo } = repoWith({ previous: null });
    await new PumpIndexService(repo as never).update("reading-1", { endIndex: "1300" }, actor());
    expect(repo.rosteredOn).not.toHaveBeenCalled();
  });
});
