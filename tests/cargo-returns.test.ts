import { describe, expect, it, vi } from "vitest";
import { cargoMovement } from "../src/modules/cargo/cargo-movement.js";
import { StockRepository } from "../src/modules/stock/stock.repository.js";
import { recordIdSchema } from "../src/shared/validation/index.js";
import { VehicleRepository, rigName } from "../src/modules/vehicles/vehicles.repository.js";
import { rigParts, rigSearch } from "../src/shared/search/index.js";
import {
  apportion, isLive, t1HeadroomFrom, takenByVessel, tripCeilingFrom, usageOf,
} from "../src/modules/stock/stock-taken.js";

/**
 * Taking a shipment back is only honest while its fuel has not moved, and the
 * figures that say so are the same ones the screen shows before anyone
 * decides. These cover the ladder — which rung gets named — and the one piece
 * of arithmetic a return depends on: a withdrawn batch is not stock.
 */

/** A cargo tree with as much or as little of the chain below it as asked for. */
function cargoWith(options: {
  nominated?: number;
  t1?: boolean;
  receipt?: boolean;
  clearance?: "none" | "uncleared" | "cleared";
  draw?: boolean;
  load?: boolean;
  received?: number;
}) {
  const receptions = options.received === undefined ? [] : [{ receivedQty: options.received }];
  const loadedOrders = options.load
    ? [{ loadingOrder: { id: "load-1", orderReceptions: receptions } }]
    : [];
  const centralStockOrders = options.draw ? [{ id: "draw-1", loadedOrders }] : [];
  const stockClearances = options.clearance && options.clearance !== "none"
    ? [{ id: "clearance-1", status: options.clearance, centralStockOrders }]
    : [];
  const centralStocks = options.receipt ? [{ id: "receipt-1", stockClearances }] : [];
  const t1Validations = options.t1 ? [{ id: "t1-1", centralStocks }] : [];
  const nominationVessels = options.nominated
    ? [{ ambQuantity: options.nominated, nomination: { id: "nomination-1", t1Validations } }]
    : [];
  return {
    quantityInLitre: 200_000,
    stocks: [{ quantity: 200_000, nominationVessels }],
  };
}

const dbFor = (cargo: unknown) =>
  ({ cargo: { findUnique: vi.fn().mockResolvedValue(cargo) } }) as never;

describe("how far a shipment's litres have travelled", () => {
  it("a shipment that never moved can go back, with all of it free", async () => {
    const movement = await cargoMovement(dbFor(cargoWith({})), "cargo-1");
    expect(movement).toMatchObject({
      stockQuantity: 200_000,
      nominatedQuantity: 0,
      freeQuantity: 200_000,
      nominations: 0,
      returnable: true,
      blockedBy: null,
    });
  });

  it("names the trucks when it is nominated, and refuses", async () => {
    const movement = await cargoMovement(dbFor(cargoWith({ nominated: 80_000 })), "cargo-1");
    expect(movement).toMatchObject({
      nominations: 1,
      nominatedQuantity: 80_000,
      freeQuantity: 120_000,
      returnable: false,
    });
    expect(movement!.blockedBy).toContain("80,000 L is nominated onto 1 truck");
  });

  it("names the furthest rung, not the first — a reception outranks the lot", async () => {
    const movement = await cargoMovement(dbFor(cargoWith({
      nominated: 200_000, t1: true, receipt: true, clearance: "cleared",
      draw: true, load: true, received: 42_000,
    })), "cargo-1");
    expect(movement).toMatchObject({
      t1Validations: 1, centralStockReceipts: 1, clearances: 1, cleared: 1,
      draws: 1, loads: 1, receptions: 1, receivedQuantity: 42_000, returnable: false,
    });
    expect(movement!.blockedBy).toContain("42,000 L");
    expect(movement!.blockedBy).toContain("received into a tank");
  });

  it("counts duty paid as a block of its own, before anything was drawn", async () => {
    const movement = await cargoMovement(dbFor(cargoWith({
      nominated: 200_000, t1: true, receipt: true, clearance: "cleared",
    })), "cargo-1");
    expect(movement).toMatchObject({ cleared: 1, draws: 0, returnable: false });
    expect(movement!.blockedBy).toContain("duty has been assessed and paid");
  });

  it("an uncleared receipt is not a block: nothing has been promised yet", async () => {
    const movement = await cargoMovement(dbFor(cargoWith({
      nominated: 200_000, t1: true, receipt: true, clearance: "uncleared",
    })), "cargo-1");
    // Still refused — but for the nomination, which is what can be unwound.
    expect(movement!.blockedBy).toContain("nominated onto");
  });

  it("is nothing at all for a cargo that does not exist", async () => {
    expect(await cargoMovement(dbFor(null), "missing")).toBeNull();
  });
});

describe("a withdrawn batch is on record but is not stock", () => {
  const item = { id: "item-1", name: "PMS", descriptions: null, status: "active", baseUnit: null };
  const row = (status: string, quantity: number) => ({
    id: `stock-${status}-${quantity}`,
    quantity,
    receivedDate: new Date("2026-11-01"),
    status,
    cargo: { id: "cargo-1", blRef: "BL-1", status: "approved" },
    deport: { id: "depot-1", name: "Dar", location: "TZ", type: "foreign", status: "active" },
    item,
    nominationVessels: [],
  });

  it("keeps returned and cancelled litres out of the total, and reports them apart", async () => {
    const db = {
      stock: {
        findMany: vi.fn().mockResolvedValue([
          row("received", 100_000),
          row("returned", 60_000),
          row("cancelled", 30_000),
        ]),
      },
    } as never;

    const [report] = await new StockRepository(db).list({
      startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
    } as never);

    expect(report!.summary.totalQuantity).toBe(100_000);
    expect(report!.summary.withdrawnQuantity).toBe(90_000);
    // Still listed, and still counted by status: the history is not hidden,
    // it is just not stock.
    expect(report!.summary.stockCount).toBe(3);
    expect(report!.summary.quantitiesByStatus).toMatchObject({
      received: 100_000, returned: 60_000, cancelled: 30_000,
    });
  });
});

describe("a cargo id may be a uuid or a cuid", () => {
  /**
   * `Cargo.id` is `@default(cuid())`, so the database makes cuids — but the
   * demo seed supplies its own ids, derived from a key so a re-seed is
   * idempotent, and those are uuids. A real database therefore holds both.
   *
   * This has been got wrong in both directions: the cargo-invoice list parsed
   * a uuid and refused every database-made shipment, then the cargo routes
   * parsed a cuid and refused every seeded one with "Must be a valid CUID".
   */
  it("takes both shapes and nothing else", () => {
    const uuid = "6734659f-ee83-4997-a1e5-c5295266f149";
    const cuid = "cm3xq8v4t0000abcd1234efgh";
    expect(recordIdSchema.safeParse(uuid).success).toBe(true);
    expect(recordIdSchema.safeParse(cuid).success).toBe(true);
    for (const rubbish of ["", "   ", "not-an-id", "123", "6734659f-ee83-4997-a1e5"]) {
      expect(recordIdSchema.safeParse(rubbish).success).toBe(false);
    }
  });
});

describe("a rig is the plate and the trailer together", () => {
  /**
   * One tractor unit is coupled to different trailers over its life, and each
   * pairing is its own rig — so the same plate may be on record twice, and the
   * pair may not. Which makes the pair the only name that identifies a truck,
   * and therefore what the list has to be searchable by: `RAB123F/TR-884`.
   */
  it("is named by the pair wherever one is written out", () => {
    expect(rigName("RAB123F", "TR-884")).toBe("RAB123F/TR-884");
  });

  /** Records the `where` each search builds, and answers no rows. */
  function spyVehicles() {
    const findMany = vi.fn().mockResolvedValue([]);
    return { db: { vehicle: { findMany } } as never, findMany };
  }

  it("splits a typed pair across the two columns, not one", async () => {
    const { db, findMany } = spyVehicles();
    // Spaces around the slash are what a person types; they must not survive
    // into the comparison.
    await new VehicleRepository(db).list({ search: "RAB123F / TR-884" });

    // One condition, both halves at once: `RAB123F/TR-884` is one rig, not
    // everything on plate RAB123F. The model and transporter conditions sit
    // beside it and match nothing — no model has a slash in it.
    const or = findMany.mock.calls[0][0].where.OR as Array<Record<string, unknown>>;
    expect(or).toEqual(expect.arrayContaining([{
      platNumber: { contains: "RAB123F" },
      trailerNumber: { contains: "TR-884" },
    }]));
    expect(or.filter((c) => 'platNumber' in c)).toHaveLength(1);
  });

  /**
   * The parsing itself, which every list that searches for a truck now shares —
   * the nominations list, the T1 lists, the finder, the drivers, the parkings
   * and the loading orders. It used to live in the vehicles repository alone,
   * so typing a pair anywhere else found nothing.
   */
  it("reads a written pair, and leaves anything else alone", () => {
    expect(rigParts("RAG153D/RL4707")).toEqual({ plate: "RAG153D", trailer: "RL4707" });
    expect(rigParts(" RAG153D / RL4707 ")).toEqual({ plate: "RAG153D", trailer: "RL4707" });
    // Half way through typing is not a pair yet.
    expect(rigParts("RAG153D/")).toBeNull();
    expect(rigParts("/RL4707")).toBeNull();
    expect(rigParts("RAG153D")).toBeNull();
    expect(rigParts(undefined)).toBeNull();
  });

  it("nests its conditions for the lists that reach a truck through a relation", () => {
    // The nominations list and the T1 finder hold a truck two relations down.
    expect(rigSearch("RAG153D/RL4707", (vechile) => ({ driverVehicle: { vechile } })))
      .toEqual([{
        driverVehicle: {
          vechile: { platNumber: { contains: "RAG153D" }, trailerNumber: { contains: "RL4707" } },
        },
      }]);
    // A single term still reaches every column a truck is known by.
    expect(rigSearch("RAG153D", (vechile) => ({ driverVehicle: { vechile } })))
      .toHaveLength(3);
  });

  it("matches one term against every field a truck is known by", async () => {
    const { db, findMany } = spyVehicles();
    await new VehicleRepository(db).list({ search: "TR-884" });

    const or = findMany.mock.calls[0][0].where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(5);
    expect(or).toEqual(expect.arrayContaining([
      { platNumber: { contains: "TR-884" } },
      { trailerNumber: { contains: "TR-884" } },
      { truckNumber: { contains: "TR-884" } },
    ]));
  });

  it("asks for everything when nothing was typed", async () => {
    const { db, findMany } = spyVehicles();
    await new VehicleRepository(db).list();
    expect(findMany.mock.calls[0][0].where).toBeUndefined();

    const blank = spyVehicles();
    await new VehicleRepository(blank.db).list({ search: "   " });
    expect(blank.findMany.mock.calls[0][0].where).toBeUndefined();
  });
});

describe("a batch is drawn down by the T1, not by the nomination", () => {
  /**
   * A nomination says which batch a truck will load from and how much, but it
   * moves nothing: planning to load does not take fuel out of a depot. The
   * litres leave when the **T1** is recorded, because that is the first time
   * anybody measured what the truck really took — customs, at the border, at
   * 20 °C.
   */
  const planned = (ambQuantity: number) => ({
    ambQuantity,
    cargoId: null,
    nomination: { t1Validations: [], nominationVessels: [{ ambQuantity, cargoId: null }] },
  });
  /*
   * Names no cargo, so it is spread across the trip's lines — the only way a
   * T1 was ever read before `cargoId`, and still how every row on record is.
   */
  const validated = (ambQuantity: number, quantityAt20C: number, siblings: number[] = []) => ({
    ambQuantity,
    cargoId: null,
    nomination: {
      // No cancelled check on it, so it draws. See the cancellation block.
      t1Validations: [{ quantityAt20C, cargoId: null, extraValidations: [] }],
      nominationVessels: [
        { ambQuantity, cargoId: null },
        ...siblings.map((q) => ({ ambQuantity: q, cargoId: null })),
      ],
    },
  });

  it("a trip with no T1 has taken nothing, however much it nominated", () => {
    expect(usageOf(100_000, [planned(40_000)])).toMatchObject({
      taken: 0, nominated: 40_000, available: 100_000,
    });
  });

  it("recording the T1 is what takes the litres out, at 20 °C", () => {
    expect(usageOf(100_000, [validated(40_000, 39_670)])).toMatchObject({
      taken: 39_670, nominated: 0, available: 60_330,
    });
  });

  it("splits one truck's T1 across the batches it loaded from", () => {
    // 20,000 of a 40,000 load came from this batch, and the T1 says 39,120.
    expect(usageOf(100_000, [validated(20_000, 39_120, [20_000])]).taken).toBeCloseTo(19_560, 2);
  });

  it("never reports a negative balance", () => {
    expect(usageOf(10_000, [validated(10_000, 12_000)]).available).toBe(0);
  });

  it("apportions nothing when a nomination draws nothing", () => {
    expect(apportion(39_120, 0, 0)).toBe(0);
  });
});

describe("a trip may be cleared on several T1s", () => {
  /**
   * `T1Validation.nominationId` used to be unique, so a trip had at most one
   * customs document. A load can be cleared on more than one declaration, or a
   * second T1 raised after a correction — so what the trip took out of its
   * batch is the **sum** of them, never the first.
   */
  const tripWith = (quantities: number[], ambQuantity = 40_000) => ({
    ambQuantity,
    cargoId: null,
    nomination: {
      t1Validations: quantities.map((quantityAt20C) => ({
        quantityAt20C, cargoId: null, extraValidations: [],
      })),
      nominationVessels: [{ ambQuantity, cargoId: null }],
    },
  });

  it("sums them rather than reading the first", () => {
    expect(usageOf(100_000, [tripWith([20_000, 19_670])])).toMatchObject({
      taken: 39_670, nominated: 0, available: 60_330,
    });
  });

  it("counts a trip as unmeasured only while it has none", () => {
    expect(usageOf(100_000, [tripWith([])])).toMatchObject({ taken: 0, nominated: 40_000 });
  });

  it("splits the summed figure across the batches the trip loaded from", () => {
    const vessel = {
      ambQuantity: 20_000,
      cargoId: null,
      nomination: {
        t1Validations: [
          { quantityAt20C: 20_000, cargoId: null, extraValidations: [] },
          { quantityAt20C: 19_120, cargoId: null, extraValidations: [] },
        ],
        nominationVessels: [
          { ambQuantity: 20_000, cargoId: null },
          { ambQuantity: 20_000, cargoId: null },
        ],
      },
    };
    // 39,120 cleared in total, half of the load came from this batch.
    expect(takenByVessel(vessel)).toBeCloseTo(19_560, 2);
  });
});

/**
 * Recording a T1 takes litres off a depot batch, so cancelling one has to put
 * them back: a declaration withdrawn at the border leaves the fuel where it
 * always was. A T1 is cancelled when any of its customs checks is — the same
 * roll-up the T1 list shows on screen — and these hold the arithmetic to it.
 */
describe("a cancelled T1 gives the fuel back", () => {
  const trip = (t1s: Array<{ quantityAt20C: number; status?: string }>, ambQuantity = 40_000) => ({
    ambQuantity,
    cargoId: null,
    nomination: {
      t1Validations: t1s.map(({ quantityAt20C, status }) => ({
        quantityAt20C,
        cargoId: null,
        extraValidations: status ? [{ status }] : [],
      })),
      nominationVessels: [{ ambQuantity, cargoId: null }],
    },
  });

  it("stops drawing on the batch", () => {
    expect(usageOf(100_000, [trip([{ quantityAt20C: 39_670, status: "cancelled" }])]))
      .toMatchObject({ taken: 0, available: 100_000 });
  });

  it("puts the trip back to planned-but-untaken, which is what it is", () => {
    expect(usageOf(100_000, [trip([{ quantityAt20C: 39_670, status: "cancelled" }])]))
      .toMatchObject({ nominated: 40_000 });
  });

  it("leaves a confirmed or still-pending one drawing", () => {
    expect(usageOf(100_000, [trip([{ quantityAt20C: 39_670, status: "confirmed" }])]).taken)
      .toBe(39_670);
    expect(usageOf(100_000, [trip([{ quantityAt20C: 39_670, status: "pending" }])]).taken)
      .toBe(39_670);
    // No checks at all is not a cancellation: nothing has been decided yet.
    expect(usageOf(100_000, [trip([{ quantityAt20C: 39_670 }])]).taken).toBe(39_670);
  });

  it("takes only the cancelled one out of a trip cleared on several", () => {
    expect(usageOf(100_000, [trip([
      { quantityAt20C: 20_000, status: "confirmed" },
      { quantityAt20C: 19_670, status: "cancelled" },
    ])])).toMatchObject({ taken: 20_000, nominated: 0, available: 80_000 });
  });

  it("counts one cancelled check as cancelling the whole T1, as the list shows it", () => {
    // A T1 passes several offices; a cancellation at any of them dominates.
    expect(isLive({ quantityAt20C: 1, cargoId: null, extraValidations: [
      { status: "confirmed" }, { status: "cancelled" },
    ] })).toBe(false);
    expect(isLive({ quantityAt20C: 1, cargoId: null, extraValidations: [
      { status: "confirmed" }, { status: "pending" },
    ] })).toBe(true);
  });

  it("gives the litres back through takenByVessel too, not only the totals", () => {
    expect(takenByVessel(trip([{ quantityAt20C: 39_670, status: "cancelled" }]))).toBe(0);
  });
});

/**
 * What the Nominations page reads to decide whether to offer a T1 at all. A
 * trip loading from several batches is held to the tightest of them, so that is
 * the figure — and `0` is what makes the button disappear rather than let
 * somebody fill a form in and be refused at the end of it.
 */
describe("the litres a trip may still be cleared for", () => {
  const batch = (ceiling: number) => ({
    stockId: "s", cargoId: null,
    quantity: 30_000, taken: 0, headroom: ceiling, ceiling, planned: 10_000,
    attributedCeiling: ceiling, vessel: null, itemName: "AGO",
  });

  it("is the tightest batch the trip loaded from", () => {
    expect(t1HeadroomFrom([batch(12_000), batch(4_500), batch(20_000)])).toBe(4_500);
  });

  it("is zero once a batch is fully cleared, which is what hides the action", () => {
    expect(t1HeadroomFrom([batch(9_000), batch(0)])).toBe(0);
  });

  it("never goes negative, however overdrawn a batch is", () => {
    expect(t1HeadroomFrom([batch(-500)])).toBe(0);
  });

  it("has nothing to say about a trip with no batches", () => {
    expect(t1HeadroomFrom([])).toBeNull();
    expect(t1HeadroomFrom(undefined)).toBeNull();
  });
});

/**
 * A truck that topped up from a second shipment is cleared on a T1 naming it,
 * and those litres belong to that shipment. Spreading them across the trip
 * would take fuel off a cargo that never gave any — so a T1 that names a cargo
 * the trip loaded from is drawn off that cargo alone.
 *
 * The rule had to arrive without moving a single figure already on record:
 * every T1 raised before `cargoId` existed names nothing, and the last block
 * here is what holds that.
 */
describe("a T1 that names a shipment draws off that shipment", () => {
  const A = "cargo-a";
  const B = "cargo-b";
  /** A trip on two shipments: 30,000 off A and 5,000 off B. */
  const twoCargos = (t1s: Array<{ quantityAt20C: number; cargoId: string | null }>) => {
    const lines = [{ ambQuantity: 30_000, cargoId: A }, { ambQuantity: 5_000, cargoId: B }];
    const nomination = {
      t1Validations: t1s.map((t1) => ({ ...t1, extraValidations: [] })),
      nominationVessels: lines,
    };
    return {
      onA: { ambQuantity: 30_000, cargoId: A, nomination },
      onB: { ambQuantity: 5_000, cargoId: B, nomination },
    };
  };

  it("puts the whole figure on the cargo it names, not a share of it", () => {
    const { onA, onB } = twoCargos([
      { quantityAt20C: 29_700, cargoId: A },
      { quantityAt20C: 5_000, cargoId: B },
    ]);
    // Exactly what each shipment gave. Apportioning would have said
    // 29,742 and 4,957 — close, and wrong about both.
    expect(takenByVessel(onA)).toBeCloseTo(29_700, 2);
    expect(takenByVessel(onB)).toBeCloseTo(5_000, 2);
  });

  it("leaves the other shipment alone when only one T1 is in", () => {
    const { onA, onB } = twoCargos([{ quantityAt20C: 5_000, cargoId: B }]);
    expect(takenByVessel(onA)).toBe(0);
    expect(takenByVessel(onB)).toBeCloseTo(5_000, 2);
  });

  it("spreads a T1 that names nothing, and adds it to what is attributed", () => {
    const { onA, onB } = twoCargos([
      { quantityAt20C: 5_000, cargoId: B },
      // Names nothing, so it is spread 30,000:5,000 — 6/7 and 1/7.
      { quantityAt20C: 7_000, cargoId: null },
    ]);
    expect(takenByVessel(onA)).toBeCloseTo(6_000, 2);
    expect(takenByVessel(onB)).toBeCloseTo(5_000 + 1_000, 2);
  });

  it("spreads one naming a cargo the trip never loaded from", () => {
    // Naming a shipment is a claim about where fuel came from; it does not put
    // the trip on that shipment. With no line to draw off, it is spread.
    const { onA, onB } = twoCargos([{ quantityAt20C: 7_000, cargoId: "cargo-elsewhere" }]);
    expect(takenByVessel(onA)).toBeCloseTo(6_000, 2);
    expect(takenByVessel(onB)).toBeCloseTo(1_000, 2);
  });

  it("gives a cancelled attributed T1 back to its own shipment", () => {
    const lines = [{ ambQuantity: 30_000, cargoId: A }, { ambQuantity: 5_000, cargoId: B }];
    const nomination = {
      t1Validations: [
        { quantityAt20C: 29_700, cargoId: A, extraValidations: [] },
        { quantityAt20C: 5_000, cargoId: B, extraValidations: [{ status: "cancelled" }] },
      ],
      nominationVessels: lines,
    };
    expect(takenByVessel({ ambQuantity: 30_000, cargoId: A, nomination })).toBeCloseTo(29_700, 2);
    // B's own T1 was withdrawn, and A's does not leak onto it.
    expect(takenByVessel({ ambQuantity: 5_000, cargoId: B, nomination })).toBe(0);
  });

  it("shares between two lines on the same shipment, in proportion", () => {
    const lines = [{ ambQuantity: 20_000, cargoId: A }, { ambQuantity: 10_000, cargoId: A }];
    const nomination = {
      t1Validations: [{ quantityAt20C: 29_700, cargoId: A, extraValidations: [] }],
      nominationVessels: lines,
    };
    expect(takenByVessel({ ambQuantity: 20_000, cargoId: A, nomination })).toBeCloseTo(19_800, 2);
    expect(takenByVessel({ ambQuantity: 10_000, cargoId: A, nomination })).toBeCloseTo(9_900, 2);
  });

  /**
   * The safety property. Everything on production names no cargo, so every
   * figure it reports must be the one it reported before this rule existed.
   */
  it("changes nothing for a trip whose T1s name no cargo", () => {
    const lines = [{ ambQuantity: 20_000, cargoId: A }, { ambQuantity: 20_000, cargoId: B }];
    const nomination = {
      t1Validations: [{ quantityAt20C: 39_120, cargoId: null, extraValidations: [] }],
      nominationVessels: lines,
    };
    // The figure from the original apportioning test, to the litre.
    expect(takenByVessel({ ambQuantity: 20_000, cargoId: A, nomination })).toBeCloseTo(19_560, 2);
    expect(usageOf(100_000, [
      { ambQuantity: 20_000, cargoId: A, nomination },
      { ambQuantity: 20_000, cargoId: B, nomination },
    ])).toMatchObject({ taken: 39_120, nominated: 0, available: 60_880 });
  });
});

/**
 * A nomination fixes a **total**: the litres that went on that truck, which is
 * what its tank holds. The T1s say where those litres came from — one shipment
 * or several — but they cannot add up to more than the truck was nominated for,
 * because the fuel was in one tank and somebody measured it.
 *
 * The case this exists for, from the yard: a truck nominated for 3,000 off one
 * vessel, and that vessel turns out to have 2,000 left. The last 1,000 is
 * cleared off a second vessel on its own T1 — and that is the end of it.
 */
describe("the T1s on one trip cannot exceed what it was nominated for", () => {
  const t1 = (quantityAt20C: number, cargoId: string | null = null, status?: string) => ({
    id: `t1-${quantityAt20C}-${cargoId ?? "none"}`,
    quantityAt20C,
    cargoId,
    extraValidations: status ? [{ status }] : [],
  });

  it("has the whole load to give before anything is cleared", () => {
    expect(tripCeilingFrom(3_000, [])).toEqual({
      nominated: 3_000, cleared: 0, remaining: 3_000,
    });
  });

  it("counts what two shipments have already cleared between them", () => {
    // The yard's example: 2,000 off the first vessel, 1,000 off the second.
    expect(tripCeilingFrom(3_000, [t1(2_000, "v1"), t1(1_000, "v2")])).toEqual({
      nominated: 3_000, cleared: 3_000, remaining: 0,
    });
  });

  it("leaves room for the second shipment when the first came up short", () => {
    expect(tripCeilingFrom(3_000, [t1(2_000, "v1")]).remaining).toBe(1_000);
  });

  it("never offers a negative remainder, however overcleared", () => {
    expect(tripCeilingFrom(3_000, [t1(4_000, "v1")]).remaining).toBe(0);
  });

  it("gives the room back when a T1 is cancelled", () => {
    expect(tripCeilingFrom(3_000, [t1(2_000, "v1"), t1(1_000, "v2", "cancelled")]))
      .toMatchObject({ cleared: 2_000, remaining: 1_000 });
  });

  it("leaves an edited T1's own figure out, so it is not weighed against itself", () => {
    const rows = [t1(2_000, "v1"), t1(1_000, "v2")];
    // Correcting the 1,000 downwards must not be refused by the 1,000.
    expect(tripCeilingFrom(3_000, rows, "t1-1000-v2").remaining).toBe(1_000);
  });

  it("counts a T1 that names nothing just the same", () => {
    // The limit is about the tank, not about where the fuel came from.
    expect(tripCeilingFrom(3_000, [t1(2_900)]).remaining).toBe(100);
  });
});

/**
 * A top-up is a line with nothing planned off it: the trip was put on the
 * shipment by its T1, because the truck loaded somewhere the plan did not say.
 * The plan is not rewritten — it never said that shipment — so the line carries
 * no ambient, and the T1 is what says what came off it.
 */
describe("a shipment the trip never planned for", () => {
  const A = "cargo-a";
  const B = "cargo-b";

  it("gives the named T1 to the unplanned line whole", () => {
    // 3,000 nominated off A; only 2,000 was there, so 1,000 came off B.
    const lines = [{ ambQuantity: 3_000, cargoId: A }, { ambQuantity: 0, cargoId: B }];
    const nomination = {
      t1Validations: [
        { quantityAt20C: 2_000, cargoId: A, extraValidations: [] },
        { quantityAt20C: 1_000, cargoId: B, extraValidations: [] },
      ],
      nominationVessels: lines,
    };
    expect(takenByVessel({ ambQuantity: 3_000, cargoId: A, nomination })).toBeCloseTo(2_000, 2);
    // Would have been zero while an unplanned line was divided by its own
    // nil ambient.
    expect(takenByVessel({ ambQuantity: 0, cargoId: B, nomination })).toBeCloseTo(1_000, 2);
  });

  it("does not let an unplanned line inflate what the trip planned", () => {
    const lines = [{ ambQuantity: 3_000, cargoId: A }, { ambQuantity: 0, cargoId: B }];
    const nomination = {
      t1Validations: [{ quantityAt20C: 1_000, cargoId: B, extraValidations: [] }],
      nominationVessels: lines,
    };
    // The plan is still 3,000 — the truck did not get bigger.
    expect(usageOf(50_000, [{ ambQuantity: 0, cargoId: B, nomination }]))
      .toMatchObject({ nominatedAmbient: 0 });
  });

  it("is left out of the limit for a T1 that names no shipment", () => {
    // An unattributed figure is split by what each line was planned for, so an
    // unplanned line takes none of it and cannot be overdrawn by one.
    expect(t1HeadroomFrom([
      { stockId: "a", cargoId: A, quantity: 30_000, taken: 0, headroom: 300,
        planned: 3_000, ceiling: 300, attributedCeiling: 300, vessel: null, itemName: "AGO" },
      { stockId: "b", cargoId: B, quantity: 46_000, taken: 0, headroom: 46_000,
        planned: 0, ceiling: Number.POSITIVE_INFINITY, attributedCeiling: 46_000,
        vessel: null, itemName: "AGO" },
    ])).toBe(300);
  });
});
