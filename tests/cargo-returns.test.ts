import { describe, expect, it, vi } from "vitest";
import { cargoMovement } from "../src/modules/cargo/cargo-movement.js";
import { StockRepository } from "../src/modules/stock/stock.repository.js";

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
