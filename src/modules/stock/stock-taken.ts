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
   * The shipment this T1 says its fuel came off, when it says.
   *
   * Set, and matching a batch the trip loaded from, it is **attributed**: the
   * whole figure is drawn from that cargo rather than spread over the trip. A
   * truck that topped up from a second shipment is cleared on a T1 naming it,
   * and those litres belong to that shipment — spreading them would take fuel
   * off a cargo that never gave it.
   *
   * Null — every row raised before this existed — keeps the apportioning
   * below, which is why nothing already on record moves.
   *
   * **Required, though nullable**: a select that left it out would quietly
   * attribute nothing and spread every T1, which looks like working code. The
   * compiler should make that impossible rather than let it be found in a
   * stock report.
   */
  cargoId: string | null;
  /**
   * Its customs checks. One cancelled check cancels the T1 — see `isLive`. An
   * empty list means nothing has been decided yet, which is not a cancellation.
   */
  extraValidations: Array<{ status: string }>;
}

/** One line of a trip: a batch it loads from, and how much off that batch. */
export interface VesselLine {
  ambQuantity: Prisma.Decimal | number;
  /**
   * The shipment behind the batch, for matching a T1 that names one. Required
   * for the same reason as `T1Usage.cargoId`: silence here is indistinguishable
   * from a trip whose cargo nobody named.
   */
  cargoId: string | null;
}

/** What a vessel line needs to carry for `usageOf` to judge it. */
export interface VesselUsage extends VesselLine {
  nomination: {
    /** Every T1 on the trip — their quantities are summed, not picked from. */
    t1Validations: T1Usage[];
    nominationVessels: VesselLine[];
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

/**
 * Whether a T1's named cargo is one this trip actually loaded from.
 *
 * A T1 naming a shipment the trip has no line on is **not** attributed to it:
 * there is no line to draw the litres off, so it falls back to being spread
 * over the trip like an untagged one. Naming a cargo is a claim about where
 * fuel came from; it does not by itself put the trip on that cargo.
 */
const attributed = (t1: T1Usage, lines: VesselLine[]) =>
  Boolean(t1.cargoId) && lines.some((line) => line.cargoId === t1.cargoId);

/**
 * What one trip took out of **this** batch, for a list that shows its trips.
 * Zero until its T1 is recorded.
 *
 * Two kinds of T1 are read differently, and a trip may carry both:
 *
 * - one that **names a cargo** the trip loaded from draws its whole figure off
 *   that cargo's line, split between them if the trip somehow has two lines on
 *   the same shipment;
 * - one that **names none** is apportioned across every line by what each drew,
 *   because customs weighed the compartment and not the batches that filled it.
 *
 * Every row raised before `cargoId` existed is of the second kind, so this is
 * the old behaviour exactly until a T1 names something.
 */
export function takenByVessel(vessel: VesselUsage): number {
  const live = liveT1s(vessel);
  if (live.length === 0) return 0;
  const lines = vessel.nomination.nominationVessels;
  const drew = num(vessel.ambQuantity);

  let taken = 0;
  let unattributed = 0;
  for (const t1 of live) {
    if (!attributed(t1, lines)) {
      unattributed += num(t1.quantityAt20C);
      continue;
    }
    // Attributed: it belongs to this line only if this line is on that cargo.
    if (vessel.cargoId !== t1.cargoId) continue;
    const onThatCargo = lines
      .filter((line) => line.cargoId === t1.cargoId)
      .reduce((sum, line) => sum + num(line.ambQuantity), 0);
    taken += apportion(num(t1.quantityAt20C), drew, onThatCargo);
  }

  const total = lines.reduce((sum, line) => sum + num(line.ambQuantity), 0);
  return taken + apportion(unattributed, drew, total);
}

/** The select `usageOf` needs, so every caller asks for the same shape. */
export const vesselUsageSelect = {
  ambQuantity: true,
  // Which shipment this line is on, so a T1 naming one can be matched to it.
  stock: { select: { cargoId: true } },
  nomination: {
    select: {
      // The checks come too: a cancelled T1 draws nothing, and that is decided
      // on them. See `isLive`. `cargoId` decides whether the T1 is attributed
      // to one shipment or spread across the trip.
      t1Validations: {
        select: {
          quantityAt20C: true,
          cargoId: true,
          extraValidations: { select: { status: true } },
        },
      },
      nominationVessels: { select: { ambQuantity: true, stock: { select: { cargoId: true } } } },
    },
  },
} satisfies Prisma.NominationVesselSelect;

/**
 * Reshapes a row read with `vesselUsageSelect` into what `usageOf` wants.
 *
 * The cargo sits under `stock` in the database and beside `ambQuantity` in the
 * arithmetic, so one function does the lifting rather than every caller.
 */
export function asVesselUsage<T extends {
  ambQuantity: Prisma.Decimal | number;
  stock?: { cargoId: string | null } | null;
  nomination: {
    t1Validations: T1Usage[];
    nominationVessels: Array<{ ambQuantity: Prisma.Decimal | number; stock?: { cargoId: string | null } | null }>;
  };
}>(row: T): VesselUsage {
  return {
    ambQuantity: row.ambQuantity,
    cargoId: row.stock?.cargoId ?? null,
    nomination: {
      t1Validations: row.nomination.t1Validations,
      nominationVessels: row.nomination.nominationVessels.map((line) => ({
        ambQuantity: line.ambQuantity,
        cargoId: line.stock?.cargoId ?? null,
      })),
    },
  };
}

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
    ...usageOf(batch.quantity, batch.nominationVessels.map(asVesselUsage)),
    status: batch.status,
    itemName: batch.item.name,
  }]));
}

/* ------------------------------------------------------------------------- *
 * How much more a trip may be cleared for
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
 * One function answers both questions below, so the refusal and the screen
 * cannot drift apart: the API would not accept a T1 the page still offered to
 * raise.
 * ------------------------------------------------------------------------- */

/** What one of a trip's batches will still take, measured in T1 litres. */
export interface BatchCeiling {
  /** The batch, and the shipment behind it. */
  stockId: string;
  cargoId: string | null;
  /** The batch's own figure — its shipment's litres. */
  quantity: number;
  /** Already cleared off it, by every trip's live T1s. */
  taken: number;
  /** `quantity − taken`: litres the batch itself has left. */
  headroom: number;
  /**
   * What a T1 on this trip that **names no cargo** may say, given that only
   * part of the trip's load came off this batch. Such a T1 is spread over
   * every line, so a truck drawing 20,000 of its 40,000 here can be cleared
   * for twice this batch's headroom before this batch is overdrawn.
   */
  ceiling: number;
  /**
   * What a T1 on this trip **naming this batch's shipment** may say. It is
   * drawn off this batch alone, so it is the batch's own headroom — unless the
   * trip somehow has two lines on the same shipment, when it is shared between
   * them in proportion.
   */
  attributedCeiling: number;
  /** For the message: the ship and its BL, or `null` where there is none. */
  vessel: string | null;
  itemName: string;
}

/**
 * Per batch, what each of these trips may still be cleared for.
 *
 * Two figures per batch, because a T1 is read two ways — see `takenByVessel`.
 * One that names a shipment is held to that shipment alone; one that names
 * none is spread over the trip, so it is held to every batch at once.
 *
 * `excludeT1Id` names a T1 whose figure is being replaced, so an edit does not
 * weigh its own old quantity against itself.
 *
 * One query for the batches, whatever the number of trips: a list asks about a
 * page of nominations at once.
 *
 * ⚠️ Ambient against 20 °C: a batch is in bill-of-lading litres and a T1 is
 * temperature-corrected, so the two never meet exactly. These are ceilings,
 * not a reconciliation — they catch the typo and the overdraw, and leave the
 * contraction to the tolerance report.
 */
export async function t1Ceilings(
  db: Db,
  nominationIds: string[],
  excludeT1Id?: string,
): Promise<Map<string, BatchCeiling[]>> {
  const result = new Map<string, BatchCeiling[]>();
  if (nominationIds.length === 0) return result;

  const lines = await db.nominationVessel.findMany({
    where: { nominationId: { in: nominationIds } },
    select: {
      nominationId: true,
      stockId: true,
      ambQuantity: true,
      stock: { select: { cargoId: true } },
    },
  });
  if (lines.length === 0) return result;

  const batches = await db.stock.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.stockId))] } },
    select: {
      id: true,
      cargoId: true,
      quantity: true,
      item: { select: { name: true } },
      cargo: { select: { vesselName: true, blRef: true } },
      nominationVessels: {
        select: {
          ambQuantity: true,
          nominationId: true,
          stock: { select: { cargoId: true } },
          nomination: {
            select: {
              // `id` as well as the usual shape, so an edit can leave its own
              // old figure out of the comparison.
              t1Validations: {
                select: {
                  id: true,
                  quantityAt20C: true,
                  cargoId: true,
                  extraValidations: { select: { status: true } },
                },
              },
              nominationVessels: {
                select: { ambQuantity: true, stock: { select: { cargoId: true } } },
              },
            },
          },
        },
      },
    },
  });
  const byId = new Map(batches.map((batch) => [batch.id, batch]));

  for (const nominationId of nominationIds) {
    const mine = lines.filter((line) => line.nominationId === nominationId);
    if (mine.length === 0) continue;
    /*
     * The whole load, from the trip's own lines: what an unattributed T1 is
     * apportioned across. Taken from this list rather than from any one
     * batch's copy of it, so a trip is read the same way whichever batch is
     * being judged.
     */
    const tripTotal = mine.reduce((sum, line) => sum + num(line.ambQuantity), 0);
    const ceilings: BatchCeiling[] = [];

    for (const line of mine) {
      const batch = byId.get(line.stockId);
      if (!batch) continue;
      const drew = num(line.ambQuantity);
      if (drew <= 0) continue;

      /*
       * What the batch has already given up: this trip's other T1s counted,
       * the one being replaced left out, and every other trip's standing as it
       * is. A cancelled T1 is not counted at all — `usageOf` sees to that.
       */
      const vessels = batch.nominationVessels.map((other) =>
        other.nominationId === nominationId && excludeT1Id
          ? {
              ...other,
              nomination: {
                ...other.nomination,
                t1Validations: other.nomination.t1Validations.filter(
                  (t1) => t1.id !== excludeT1Id,
                ),
              },
            }
          : other);
      const taken = usageOf(batch.quantity, vessels.map(asVesselUsage)).taken;
      const headroom = num(batch.quantity) - taken;
      // What this trip draws off **this shipment**, across however many lines
      // it has on it. Normally the one line, so normally `drew`.
      const onThisCargo = mine
        .filter((other) => other.stock.cargoId === batch.cargoId)
        .reduce((sum, other) => sum + num(other.ambQuantity), 0);
      ceilings.push({
        stockId: batch.id,
        cargoId: batch.cargoId,
        quantity: num(batch.quantity),
        taken,
        headroom,
        ceiling: Math.max(0, (headroom * tripTotal) / drew),
        attributedCeiling: Math.max(0, (headroom * onThisCargo) / drew),
        vessel: batch.cargo ? `${batch.cargo.vesselName} (BL ${batch.cargo.blRef})` : null,
        itemName: batch.item.name,
      });
    }
    result.set(nominationId, ceilings);
  }
  return result;
}

/**
 * The most a **new, unattributed** T1 on this trip may say, in litres at 20 °C
 * — the trip's tightest batch. `0` means the trip's shipments are fully cleared
 * and no further T1 can be raised against it without naming a shipment of its
 * own.
 *
 * `null` where there is no limit to state: a trip with no vessel lines, or none
 * whose batches are on record.
 */
export function t1HeadroomFrom(ceilings: BatchCeiling[] | undefined): number | null {
  if (!ceilings || ceilings.length === 0) return null;
  return Math.max(0, Math.min(...ceilings.map((batch) => batch.ceiling)));
}

/**
 * The same, read straight from the database for a page of nominations.
 *
 * Returns the unattributed headroom and the per-batch ceilings beside it, so a
 * caller offering a choice of shipment can say what each one will still take.
 */
export async function t1HeadroomOf(db: Db, nominationIds: string[]) {
  const ceilings = await t1Ceilings(db, nominationIds);
  return new Map(
    nominationIds.map((id) => [id, {
      headroom: t1HeadroomFrom(ceilings.get(id)),
      batches: ceilings.get(id) ?? [],
    }] as const),
  );
}

/**
 * Refuses a T1 that would clear more fuel than the shipment holds.
 *
 * Reads the same ceilings the nominations list is given, so a T1 the page still
 * offers to raise is one this will accept.
 *
 * `cargoId` is the shipment the T1 names, when it names one. Such a T1 is drawn
 * off that shipment alone, so it is judged against that batch and no other —
 * which is the whole point of naming it: a truck that topped up from a second
 * cargo is not held to the headroom of the first.
 */
export async function assertT1WithinCargo(
  db: Db,
  nominationId: string,
  quantityAt20C: number,
  excludeT1Id?: string,
  cargoId?: string | null,
) {
  const ceilings = (await t1Ceilings(db, [nominationId], excludeT1Id)).get(nominationId);
  if (!ceilings) return;

  // Named a shipment the trip loads from: that batch alone, at its own ceiling.
  const named = cargoId ? ceilings.find((batch) => batch.cargoId === cargoId) : undefined;
  const judged = named
    ? [{ batch: named, against: named.attributedCeiling }]
    : ceilings.map((batch) => ({ batch, against: batch.ceiling }));

  for (const { batch, against } of judged) {
    // A hundredth of a litre of slack: the ceiling is a division, and refusing
    // a T1 over floating-point dust would be a lie about the fuel.
    if (quantityAt20C <= against + 0.01) continue;
    const vessel = batch.vessel ?? "This batch";
    const whole = Math.abs(against - batch.headroom) <= 0.01;
    throw new BusinessError(
      "CARGO_QUANTITY_EXCEEDED",
      `${vessel} cannot clear this much ${batch.itemName}. `
      + `Its ${batch.quantity.toLocaleString()} litres already carry `
      + `${Math.round(batch.taken).toLocaleString()} cleared on T1s, leaving `
      + `${Math.round(batch.headroom).toLocaleString()}`
      + (whole
        ? `, so at most ${Math.round(against).toLocaleString()} can be cleared on it.`
        // Said plainly, because the figure refused is not the figure compared:
        // the trip loaded from more than one batch.
        : ` — and this trip drew only part of its load from it, so at most `
          + `${Math.round(against).toLocaleString()} can be cleared here.`),
      422,
      {
        batchQuantity: batch.quantity,
        alreadyCleared: batch.taken,
        headroom: batch.headroom,
        ceiling: against,
      },
    );
  }
}
