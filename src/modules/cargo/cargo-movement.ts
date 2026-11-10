import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";

type Db = PrismaClient | Prisma.TransactionClient;

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

/**
 * How far a shipment's litres have actually travelled.
 *
 * A cargo becomes depot `Stock`, which is nominated onto trucks, validated as
 * a T1, received as a `CentralStock` receipt, cleared, drawn against, loaded
 * and finally received into a tank at a station — where it is mixed with other
 * fuel and sold. Taking a shipment back is only honest while **none** of that
 * has happened: past a certain point there is nothing left to send to the
 * supplier, and a flag saying otherwise would be a lie in the records.
 *
 * So the same figures do two jobs. They gate the return, and they are shown on
 * the screen before anyone presses it — the pattern the requisition's
 * availability already follows, so a refusal is never the first time someone
 * learns the number.
 */
export interface CargoMovement {
  /** The shipment's own volume, as recorded. */
  quantityInLitre: number;
  /** Depot stock raised against it, and how much of that is spoken for. */
  stockQuantity: number;
  nominatedQuantity: number;
  freeQuantity: number;
  /** Each rung below it, counted. Zero everywhere means it never moved. */
  nominations: number;
  t1Validations: number;
  centralStockReceipts: number;
  clearances: number;
  /** Clearances that have been cleared — taxes assessed and paid. */
  cleared: number;
  /** Draws against those clearances: stock promised to a station or a buyer. */
  draws: number;
  loads: number;
  receptions: number;
  receivedQuantity: number;
  /**
   * Whether the shipment can still go back, and when it cannot, the sentence
   * that says what is in the way — naming the rung and the figures, not just
   * "it has moved".
   */
  returnable: boolean;
  blockedBy: string | null;
}

/** Every rung under one shipment, in one query. */
export async function cargoMovement(db: Db, cargoId: string): Promise<CargoMovement | null> {
  const cargo = await db.cargo.findUnique({
    where: { id: cargoId },
    select: {
      quantityInLitre: true,
      stocks: {
        select: {
          quantity: true,
          nominationVessels: {
            select: {
              ambQuantity: true,
              nomination: {
                select: {
                  id: true,
                  t1Validations: {
                    select: {
                      id: true,
                      centralStocks: {
                        select: {
                          id: true,
                          stockClearances: {
                            select: {
                              id: true, status: true,
                              centralStockOrders: {
                                select: {
                                  id: true,
                                  loadedOrders: {
                                    select: {
                                      loadingOrder: {
                                        select: {
                                          id: true,
                                          orderReceptions: { select: { receivedQty: true } },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!cargo) return null;

  const stockQuantity = cargo.stocks.reduce((sum, stock) => sum + num(stock.quantity), 0);
  const vessels = cargo.stocks.flatMap((stock) => stock.nominationVessels);
  const nominatedQuantity = vessels.reduce((sum, vessel) => sum + num(vessel.ambQuantity), 0);

  // Counted as sets: one nomination can draw from several of this cargo's
  // stock rows, and one load can carry several draws, so counting the rows
  // would report the same truck twice.
  const nominations = new Set<string>();
  const t1Validations = new Set<string>();
  const receipts = new Set<string>();
  const clearances = new Set<string>();
  const cleared = new Set<string>();
  const draws = new Set<string>();
  const loads = new Set<string>();
  const receptions: number[] = [];

  for (const vessel of vessels) {
    nominations.add(vessel.nomination.id);
    for (const t1 of vessel.nomination.t1Validations) {
      t1Validations.add(t1.id);
      for (const receipt of t1.centralStocks) {
        receipts.add(receipt.id);
        for (const clearance of receipt.stockClearances) {
          clearances.add(clearance.id);
          if (clearance.status === "cleared") cleared.add(clearance.id);
          for (const draw of clearance.centralStockOrders) {
            draws.add(draw.id);
            for (const line of draw.loadedOrders) {
              loads.add(line.loadingOrder.id);
              for (const reception of line.loadingOrder.orderReceptions) {
                receptions.push(num(reception.receivedQty));
              }
            }
          }
        }
      }
    }
  }

  const receivedQuantity = receptions.reduce((sum, quantity) => sum + quantity, 0);
  const litres = (value: number) => `${value.toLocaleString("en-US")} L`;

  /*
   * Read outside in: the furthest rung is the one worth naming, because it is
   * the one that cannot be undone. A reception is fuel in somebody's tank; a
   * draw is fuel promised; a cleared batch is duty paid.
   */
  const blockedBy = receptions.length > 0
    ? `${litres(receivedQuantity)} of this shipment has already been received into a tank at a station, where it is mixed with other fuel. It cannot go back to the supplier.`
    : loads.size > 0
      ? `This shipment is on ${loads.size} loading order(s) and cannot be taken back while it is on a truck. Cancel those loads first.`
      : draws.size > 0
        ? `${draws.size} request(s) have been served from this shipment's cleared stock. Those draws have to be unwound before it can go back.`
        : cleared.size > 0
          ? `${cleared.size} of its clearances have been cleared — duty has been assessed and paid on this shipment. Clearing that is not something a return can undo on its own.`
          : nominations.size > 0
            ? `${litres(nominatedQuantity)} is nominated onto ${nominations.size} truck(s). Cancel those nominations and it can go back.`
            : null;

  return {
    quantityInLitre: num(cargo.quantityInLitre),
    stockQuantity,
    nominatedQuantity,
    freeQuantity: stockQuantity - nominatedQuantity,
    nominations: nominations.size,
    t1Validations: t1Validations.size,
    centralStockReceipts: receipts.size,
    clearances: clearances.size,
    cleared: cleared.size,
    draws: draws.size,
    loads: loads.size,
    receptions: receptions.length,
    receivedQuantity,
    returnable: blockedBy === null,
    blockedBy,
  };
}
