import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";

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

/** What a vessel line needs to carry for `usageOf` to judge it. */
export interface VesselUsage {
  ambQuantity: Prisma.Decimal | number;
  nomination: {
    t1Validations: Array<{ quantityAt20C: Prisma.Decimal | number }>;
    nominationVessels: Array<{ ambQuantity: Prisma.Decimal | number }>;
  };
}

/** The select `usageOf` needs, so every caller asks for the same shape. */
export const vesselUsageSelect = {
  ambQuantity: true,
  nomination: {
    select: {
      t1Validations: { select: { quantityAt20C: true } },
      nominationVessels: { select: { ambQuantity: true } },
    },
  },
} satisfies Prisma.NominationVesselSelect;

/** Taken and nominated for one batch, from its vessel lines. */
export function usageOf(quantity: Prisma.Decimal | number, vessels: VesselUsage[]): BatchUsage {
  let taken = 0;
  let nominated = 0;
  for (const vessel of vessels) {
    const drew = num(vessel.ambQuantity);
    // At most one T1 per nomination — `nominationId` is unique on it.
    const t1 = vessel.nomination.t1Validations[0];
    if (t1) {
      const total = vessel.nomination.nominationVessels.reduce(
        (sum, line) => sum + num(line.ambQuantity), 0);
      taken += apportion(num(t1.quantityAt20C), drew, total);
    } else {
      nominated += drew;
    }
  }
  const total = num(quantity);
  return {
    quantity: total,
    taken,
    nominated,
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
