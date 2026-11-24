import { describe, expect, it, vi } from "vitest";
import { CargoRepository } from "../src/modules/cargo/cargo.repository.js";

/**
 * Moving an approved shipment to another depot.
 *
 * The point of the whole thing is the second write: approval copies the depot
 * onto each `Stock` batch, and it is the batch the stock report and the
 * nomination picker read. A cargo moved on its own would still be offered from
 * a depot its fuel was never in — so these check that the batches go with it,
 * and that the states where the move would mean nothing are refused.
 */

function repoFor(options: {
  cargo?: { id: string; status: string; deportId: string } | null;
  depot?: { id: string; name: string; status: string } | null;
}) {
  const stockUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
  const cargoUpdate = vi.fn().mockImplementation(({ data }) =>
    Promise.resolve({ id: "cargo-1", status: "approved", deportId: data.deportId }));
  const tx = { stock: { updateMany: stockUpdateMany }, cargo: { update: cargoUpdate } };
  const db = {
    cargo: { findUnique: vi.fn().mockResolvedValue(options.cargo === undefined
      ? { id: "cargo-1", status: "approved", deportId: "depot-old" }
      : options.cargo) },
    deport: { findUnique: vi.fn().mockResolvedValue(options.depot === undefined
      ? { id: "depot-new", name: "Kigali", status: "active" }
      : options.depot) },
    $transaction: vi.fn().mockImplementation((run: (t: unknown) => unknown) => run(tx)),
  };
  return { repo: new CargoRepository(db as never), stockUpdateMany, cargoUpdate };
}

describe("moving an approved shipment to another depot", () => {
  it("moves the batches in the same write as the cargo", async () => {
    const { repo, stockUpdateMany, cargoUpdate } = repoFor({});
    const moved = await repo.changeDepot("cargo-1", "depot-new");

    // Every batch of the shipment, not only the live ones: a shipment is in
    // one place, and a row left behind would split it across two depots.
    expect(stockUpdateMany).toHaveBeenCalledWith({
      where: { cargoId: "cargo-1" },
      data: { deportId: "depot-new" },
    });
    expect(cargoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cargo-1", status: "approved" },
      data: { deportId: "depot-new" },
    }));
    expect(moved).toMatchObject({
      deportId: "depot-new", movedBatches: 2, previousDeportId: "depot-old",
    });
  });

  it("sends a pending shipment back to its edit form instead", async () => {
    const { repo, stockUpdateMany } = repoFor({
      cargo: { id: "cargo-1", status: "pending", deportId: "depot-old" },
    });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/edit it instead/);
    expect(stockUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a shipment that has been sent back", async () => {
    const { repo, stockUpdateMany } = repoFor({
      cargo: { id: "cargo-1", status: "returned", deportId: "depot-old" },
    });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/finished with/);
    expect(stockUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses the depot it is already in, rather than writing nothing twice", async () => {
    const { repo, stockUpdateMany } = repoFor({
      cargo: { id: "cargo-1", status: "approved", deportId: "depot-new" },
    });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/already in that depot/);
    expect(stockUpdateMany).not.toHaveBeenCalled();
  });

  it("will not move stock into a depot that is no longer in use", async () => {
    const { repo, stockUpdateMany } = repoFor({
      depot: { id: "depot-new", name: "Old Kigali", status: "inactive" },
    });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/Old Kigali is not active/);
    expect(stockUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a depot that does not exist", async () => {
    const { repo } = repoFor({ depot: null });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/Depot not found/);
  });

  it("refuses a shipment that does not exist", async () => {
    const { repo } = repoFor({ cargo: null });
    await expect(repo.changeDepot("cargo-1", "depot-new")).rejects.toThrow(/Cargo not found/);
  });
});
