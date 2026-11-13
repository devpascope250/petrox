import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError } from "../../utils/errors.js";

type Db = PrismaClient | Prisma.TransactionClient;

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

/**
 * What has actually been taken out of a depot batch.
 *
 * A nomination is a plan: it says which batch a truck will load from and how
 * much, but it moves nothing. **The litres leave the batch when the T1 is
 * recorded**, because the T1 is the first measurement of what the truck really
 * took — customs weighed it at the border, at 20 °C. Until then the trip has
 * taken nothing, however much it nominated.
 *
 * A trip may carry **more than one** T1 — a load split across declarations, or
 * a second raised after a correction — so what it took is the **sum** of them.
 *
 * A **cancelled** T1 draws nothing. Recording a T1 takes litres off a batch, so
 * cancelling one has to put them back, or a declaration withdrawn at the border
 * would go on holding fuel that is still in the tank. A T1 is cancelled when
 * any of its customs checks is — the same rule the T1 list shows on screen —
 * and the trip then reads as nominated-but-untaken again, which is what it is.
 *
 * ⚠️ The batch is in **ambient** litres from the bill of lading and a T1 is at
 * 20 °C, so the two do not meet exactly: fuel contracts as it cools, and the
 * last trip off a batch leaves a small remainder — roughly 0.8% of the cargo
 * for diesel, 1.2% for petrol, per 10 °C above 20. That residue is not fuel
 * anybody can load, and a batch is retired by hand once its trips are done
 * (`StockStatus.closed`).
 */
export interface BatchUsage {
  /** The batch's own figure, as the cargo was approved. */
  quantity: number;
  /** Confirmed gone: the T1 litres of the trips that loaded from it. */
  taken: number;
  /** Planned but unconfirmed — nominations with no T1 yet. Informational. */
  nominated: number;
  /**
   * What **every** trip on this batch planned to draw, T1 or not, in ambient
   * litres. Shown beside `taken` so the two can be read against each other:
   * the gap between them is the trips still waiting for a T1, plus the
   * contraction between the depot's ambient litres and the border's 20 °C
   * ones. Holds nothing back either — it is a figure to read, not a balance.
   */
  nominatedAmbient: number;
  /** `quantity − taken`, never below zero. What may still be nominated. */
  available: number;
}

/**
 * One truck, one T1 — but a truck may load from several batches, so the T1's
 * figure is split across its vessel lines in proportion to what each drew.
 *
 * 20,000 from one batch and 20,000 from another, under a T1 of 39,120, is
 * 19,560 from each. There is no finer truth available: customs weighed the
 * compartment, not the batches that filled it.
 */
export function apportion(t1Quantity: number, vesselQuantity: number, nominationTotal: number) {
  if (nominationTotal <= 0) return 0;
  return (t1Quantity * vesselQuantity) / nominationTotal;
}

/** One T1, as the litre sums need to read it. */
export interface T1Usage {
  quantityAt20C: Prisma.Decimal | number;
  /**
   * Its customs checks. One cancelled check cancels the T1 — see `isLive`. An
   * empty list means nothing has been decided yet, which is not a cancellation.
   */
  extraValidations: Array<{ status: string }>;
}

/** What a vessel line needs to carry for `usageOf` to judge it. */
export interface VesselUsage {
  ambQuantity: Prisma.Decimal | number;
  nomination: {
    /** Every T1 on the trip — their quantities are summed, not picked from. */
    t1Validations: T1Usage[];
    nominationVessels: Array<{ ambQuantity: Prisma.Decimal | number }>;
  };
}

/**
 * Whether a T1 still draws fuel.
 *
 * Any cancelled customs check cancels it. That is the rule the T1 list already
 * shows — a cancellation dominates the roll-up — and the litres have to follow
 * it, or the screen and the stock disagree about the same row.
 */
export const isLive = (t1: T1Usage) =>
  !t1.extraValidations.some((check) => check.status === "cancelled");

/** The T1s of a trip that still draw on its batches. */
export const liveT1s = (vessel: VesselUsage) => vessel.nomination.t1Validations.filter(isLive);

/** Everything this trip was cleared for, across all of its live T1s. */
const clearedOn = (vessel: VesselUsage) =>
  liveT1s(vessel).reduce((sum, t1) => sum + num(t1.quantityAt20C), 0);

/**
 * What one trip took out of **this** batch, for a list that shows its trips.
 * Zero until its T1 is recorded. Same apportioning as `usageOf`.
 */
export function takenByVessel(vessel: VesselUsage): number {
  if (liveT1s(vessel).length === 0) return 0;
  const total = vessel.nomination.nominationVessels.reduce(
    (sum, line) => sum + num(line.ambQuantity), 0);
  return apportion(clearedOn(vessel), num(vessel.ambQuantity), total);
}

/** The select `usageOf` needs, so every caller asks for the same shape. */
export const vesselUsageSelect = {
  ambQuantity: true,
  nomination: {
    select: {
      // The checks come too: a cancelled T1 draws nothing, and that is decided
      // on them. See `isLive`.
      t1Validations: {
        select: { quantityAt20C: true, extraValidations: { select: { status: true } } },
      },
      nominationVessels: { select: { ambQuantity: true } },
    },
  },
} satisfies Prisma.NominationVesselSelect;

/** Taken and nominated for one batch, from its vessel lines. */
export function usageOf(quantity: Prisma.Decimal | number, vessels: VesselUsage[]): BatchUsage {
  let taken = 0;
  let nominated = 0;
  let nominatedAmbient = 0;
  for (const vessel of vessels) {
    const drew = num(vessel.ambQuantity);
    nominatedAmbient += drew;
    // A trip may hold several T1s, so what it was cleared for is their sum.
    // A trip whose T1s were all cancelled is back to being a plan.
    if (liveT1s(vessel).length > 0) {
      taken += takenByVessel(vessel);
    } else {
      nominated += drew;
    }
  }
  const total = num(quantity);
  return {
    quantity: total,
    taken,
    nominated,
    nominatedAmbient,
    available: Math.max(0, total - taken),
  };
}

/** The same, read straight from the database for a set of batches. */
export async function usageOfBatches(db: Db, stockIds: string[]) {
  const batches = await db.stock.findMany({
    where: { id: { in: stockIds } },
    select: {
      id: true,
      quantity: true,
      status: true,
      item: { select: { name: true } },
      nominationVessels: { select: vesselUsageSelect },
    },
  });
  return new Map(batches.map((batch) => [batch.id, {
    ...usageOf(batch.quantity, batch.nominationVessels),
    status: batch.status,
    itemName: batch.item.name,
  }]));
}

/**
 * Refuses a T1 that would clear more fuel than the shipment holds.
 *
 * A nomination is already held to the batch it draws on: `assertStockCapacity`
 * will not let a trip plan more than the batch has left. The T1 was held to
 * nothing — and the T1 is the figure that actually moves the litres, so a
 * mistyped one could clear 300,000 out of a 30,000 cargo and the batch would
 * report it as taken.
 *
 * A batch's quantity **is** its shipment's `quantityInLitre`, copied when the
 * cargo was approved, so holding each batch to its own figure is holding the
 * cargo to its litres.
 *
 * Judged per batch rather than on the trip's total, because a truck may load
 * from several and the shortfall belongs to whichever one is short. The T1 is
 * apportioned across them exactly as `usageOf` apportions it, so the guard and
 * the report cannot disagree about what a T1 draws.
 *
 * `excludeT1Id` names a T1 whose figure is being replaced, so an edit does not
 * weigh its own old quantity against itself.
 *
 * ⚠️ Ambient against 20 °C: a batch is in bill-of-lading litres and a T1 is
 * temperature-corrected, so the two never meet exactly. This is a ceiling, not
 * a reconciliation — it catches the typo and the overdraw, and leaves the
 * contraction to the tolerance report.
 */
export async function assertT1WithinCargo(
  db: Db,
  nominationId: string,
  quantityAt20C: number,
  excludeT1Id?: string,
) {
  const lines = await db.nominationVessel.findMany({
    where: { nominationId },
    select: { stockId: true },
  });
  if (lines.length === 0) return;

  const batches = await db.stock.findMany({
    where: { id: { in: lines.map((line) => line.stockId) } },
    select: {
      quantity: true,
      item: { select: { name: true } },
      cargo: { select: { vesselName: true, blRef: true } },
      nominationVessels: {
        select: {
          ambQuantity: true,
          nominationId: true,
          nomination: {
            select: {
              // `id` as well as the usual shape, so an edit can leave its own
              // old figure out of the comparison.
              t1Validations: {
                select: {
                  id: true,
                  quantityAt20C: true,
                  extraValidations: { select: { status: true } },
                },
              },
              nominationVessels: { select: { ambQuantity: true } },
            },
          },
        },
      },
    },
  });

  for (const batch of batches) {
    /*
     * What the batch has already given up, with this trip's other T1s counted
     * and the one being replaced left out. Everything else on the batch is
     * untouched — other trips' T1s stand as they are.
     */
    const without = batch.nominationVessels.map((line) =>
      line.nominationId === nominationId
        ? {
            ...line,
            nomination: {
              ...line.nomination,
              t1Validations: line.nomination.t1Validations.filter(
                (t1) => t1.id !== excludeT1Id,
              ),
            },
          }
        : line);
    const taken = usageOf(batch.quantity, without).taken;
    const headroom = num(batch.quantity) - taken;

    // This trip's share of the batch, and so the share of the new T1 that
    // would be drawn from it.
    const mine = batch.nominationVessels.filter((line) => line.nominationId === nominationId);
    const drew = mine.reduce((sum, line) => sum + num(line.ambQuantity), 0);
    if (drew <= 0) continue;
    const tripTotal = mine[0]!.nomination.nominationVessels.reduce(
      (sum, line) => sum + num(line.ambQuantity), 0);
    const share = apportion(quantityAt20C, drew, tripTotal);

    // A hundredth of a litre of slack: the share is a division, and refusing a
    // T1 over floating-point dust would be a lie about the fuel.
    if (share > headroom + 0.01) {
      const vessel = batch.cargo
        ? `${batch.cargo.vesselName} (BL ${batch.cargo.blRef})`
        : "this batch";
      // What the whole T1 could be, given this batch's share of the trip.
      const ceiling = Math.max(0, (headroom * tripTotal) / drew);
      throw new BusinessError(
        "CARGO_QUANTITY_EXCEEDED",
        `${vessel} cannot clear this much ${batch.item.name}. `
        + `Its ${num(batch.quantity).toLocaleString()} litres already carry `
        + `${Math.round(taken).toLocaleString()} cleared on T1s, leaving `
        + `${Math.round(headroom).toLocaleString()}`
        + (tripTotal > drew
          // Said plainly, because the figure refused is not the figure compared:
          // the trip loaded from more than one batch.
          ? ` — and this trip draws ${Math.round(drew).toLocaleString()} of its `
            + `${Math.round(tripTotal).toLocaleString()} from it, so at most `
            + `${Math.round(ceiling).toLocaleString()} can be cleared here.`
          : `, so at most ${Math.round(ceiling).toLocaleString()} can be cleared on it.`),
        422,
        { batchQuantity: num(batch.quantity), alreadyCleared: taken, headroom, ceiling },
      );
    }
  }
}
