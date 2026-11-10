import type { Prisma } from "../../../prisma/generated/prisma/client.js";

export interface ItemAvailability {
  itemId: string;
  /** Cleared litres on batches still in stock. */
  cleared: number;
  /** Already drawn against those clearances — loaded, or on a load being built. */
  drawn: number;
  /** Accepted on other requisitions and not yet drawn: a promise outstanding. */
  promised: number;
  /** `cleared - drawn - promised`: what another requisition may still be granted. */
  available: number;
}

/**
 * What of an item may still be promised to a station.
 *
 * Three figures, not one, because they answer different questions and a single
 * "available" number hides the argument:
 *
 * - **cleared** is what customs has released on batches still in stock. Only
 *   cleared litres may serve a station; uncleared stock is not ours to move.
 * - **drawn** is what has actually been taken against those clearances, which
 *   is the same sum the clearance screen and the stock reports compute from
 *   `clearance.centralStockOrders`.
 * - **promised** is what other requisitions have been *accepted* for and not
 *   yet drawn. Accepting does not reserve stock — the stock is committed when
 *   a load is built — so without this figure two stations are each told yes
 *   for litres only one of them can have, and the second finds out at the
 *   gate.
 *
 * A batch's **physical** balance caps its cleared figure as well: a clearance
 * is a legal permission, and litres already gone cannot be served however the
 * paperwork reads.
 *
 * `exceptRequisitionId` leaves a requisition's own promise out, so re-deciding
 * one does not count it against itself.
 */
export async function itemAvailability(
  tx: Prisma.TransactionClient,
  itemIds: string[],
  exceptRequisitionId?: string,
): Promise<Map<string, ItemAvailability>> {
  const unique = [...new Set(itemIds)];
  const stocks = await tx.centralStock.findMany({
    where: { itemId: { in: unique }, status: "inStock" },
    select: {
      itemId: true,
      transactions: { select: { quantity: true, type: true } },
      stockClearances: {
        where: { status: "cleared" },
        select: { quantity: true, centralStockOrders: { select: { quantity: true } } },
      },
    },
  });

  const result = new Map<string, ItemAvailability>(
    unique.map((itemId) => [itemId, { itemId, cleared: 0, drawn: 0, promised: 0, available: 0 }]),
  );

  for (const stock of stocks) {
    const row = result.get(stock.itemId)!;
    const physical = stock.transactions.reduce((balance, movement) => {
      const quantity = Number(movement.quantity);
      return movement.type === "received" || movement.type === "reconcilliationIn"
        ? balance + quantity
        : balance - quantity;
    }, 0);
    const cleared = stock.stockClearances.reduce((sum, row) => sum + Number(row.quantity), 0);
    const drawn = stock.stockClearances.reduce(
      (sum, clearance) => sum + clearance.centralStockOrders.reduce(
        (taken, draw) => taken + Number(draw.quantity), 0), 0);
    // Litres already gone cannot be served, whatever the clearance says.
    row.cleared += Math.min(cleared, Math.max(0, physical + drawn));
    row.drawn += drawn;
  }

  const promises = await tx.requisitionLine.findMany({
    where: {
      itemId: { in: unique },
      // Only a live promise counts: a refused or withdrawn requisition claims
      // nothing, and a delivered one has already been drawn.
      requisition: {
        step: { in: ["accepted", "loading"] },
        ...(exceptRequisitionId ? { id: { not: exceptRequisitionId } } : {}),
      },
    },
    select: { itemId: true, approvedQuantity: true, quantity: true, loadedQuantity: true },
  });
  for (const line of promises) {
    const row = result.get(line.itemId)!;
    const granted = Number(line.approvedQuantity ?? line.quantity);
    // What is still to be drawn on that promise; a line already fully loaded
    // is counted in `drawn`, so counting it here as well would double it.
    row.promised += Math.max(0, granted - Number(line.loadedQuantity));
  }

  for (const row of result.values()) {
    row.available = Math.max(0, row.cleared - row.drawn - row.promised);
  }
  return result;
}
