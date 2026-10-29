import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { fromDate, toDate } from "../shifts/shift-scope.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Two decimals: what the money columns hold, so nothing is rounded away silently. */
const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);

/**
 * A plate compared by its letters and digits only, so `RAD 123 A`, `rad123a`
 * and `RAD-123-A` are one car — the same rule the POS sales use.
 */
const plateKey = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The subsidy recorded against a sale: **a fixed amount towards each unit
 * sold**, not a percentage. A rate of 240 on 11.34 litres is 2,721.60.
 */
export type SaleSubsidy = {
  subsidyId: string;
  /** Towards each unit sold, as the subsidy stood when the sale was priced. */
  rate: Prisma.Decimal;
  /** `quantity × rate`. */
  amount: Prisma.Decimal;
  /** The client's car that earned it, so the claim can say which vehicle. */
  car: { id: string; plateNo: string };
};

/** What a sale carries for a subsidy. `null` throughout when none applies. */
export type SubsidisedSale = { subsidyAmount: Prisma.Decimal; subsidy: SaleSubsidy | null };

/**
 * The client's car this sale was for, **only if it may earn a subsidy**. All
 * of this has to hold: the **client** is flagged `subsidyAllowed`; the **car**
 * is the client's own, active and flagged `subsidyAllowed`; and the car takes
 * **the product being pumped** — one allowed diesel earns nothing on a tank of
 * petrol.
 *
 * The car is found by the card at the pump first (the assignment that is still
 * in force), and otherwise by the plate number the attendant recorded. Without
 * a client there is nobody to claim for, so a walk-in never earns a subsidy.
 */
export async function subsidisedCar(db: Db, where: {
  itemId: string;
  clientId?: string | null;
  cardCopyId?: bigint | null;
  platNumber?: string | null;
}) {
  if (!where.clientId) return null;
  const allowed = {
    clientId: where.clientId, itemId: where.itemId, status: "active" as const, subsidyAllowed: true,
    // The client's own flag, checked in the same query so a car cannot earn a
    // subsidy for a client who is not allowed one.
    client: { subsidyAllowed: true },
  };

  if (where.cardCopyId) {
    const assignment = await db.clientCarCardAssignment.findFirst({
      where: { cardCopyId: where.cardCopyId, status: "active", unassignedAt: null, clientCar: allowed },
      orderBy: { assignedAt: "desc" },
      select: { clientCar: { select: { id: true, plateNo: true } } },
    });
    if (assignment) return assignment.clientCar;
  }

  if (where.platNumber) {
    // Plates are stored as they were typed, so they are compared normalised.
    // One client's allowed cars for one product is a short list.
    const key = plateKey(where.platNumber);
    const cars = await db.clientCar.findMany({ where: allowed, select: { id: true, plateNo: true } });
    return cars.find((car) => plateKey(car.plateNo) === key) ?? null;
  }

  return null;
}

/**
 * The subsidy in force for a product on a day: active, within its period, at
 * this site or at every site (`siteId` empty). A site's own rate is preferred
 * over the company-wide one, which is also how `GET /subsidies/active` reads
 * it. A product has at most one active subsidy, so there is nothing to choose
 * between beyond that.
 */
export async function subsidyInForce(db: Db, where: { itemId: string; siteId?: string | null; at?: Date }) {
  const day = toDate(fromDate(where.at ?? new Date()));
  return db.subsidy.findFirst({
    where: {
      itemId: where.itemId, status: "active", from: { lte: day }, to: { gte: day },
      ...(where.siteId ? { OR: [{ siteId: where.siteId }, { siteId: null }] } : {}),
    },
    orderBy: [{ siteId: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, rate: true },
  });
}

/**
 * The subsidy to record against a sale: nothing unless the sale was for a
 * client's own car that is **allowed** one and takes the product being
 * pumped, and a subsidy is in force for that product here today.
 *
 * Like a discount, it is **recorded, not deducted**: the customer still pays
 * what the pump showed, and `subsidyRate`/`subsidyAmount` are the sale's own
 * copies, so editing or retiring the subsidy later cannot rewrite them.
 */
export async function subsidyForSale(db: Db, input: {
  itemId: string;
  siteId: string;
  quantity: Prisma.Decimal;
  clientId?: string | null;
  cardCopyId?: bigint | null;
  platNumber?: string | null;
  at?: Date;
}): Promise<SubsidisedSale> {
  const none = { subsidyAmount: new Prisma.Decimal(0), subsidy: null };
  const car = await subsidisedCar(db, input);
  if (!car) return none;
  const subsidy = await subsidyInForce(db, input);
  if (!subsidy || subsidy.rate.lessThanOrEqualTo(0)) return none;

  const amount = money(input.quantity.times(subsidy.rate));
  return { subsidyAmount: amount, subsidy: { subsidyId: subsidy.id, rate: subsidy.rate, amount, car } };
}

/** The subsidy columns a sale carries, from what `subsidyForSale` worked out. */
export function subsidyColumns(subsidised: SubsidisedSale) {
  return {
    subsidyId: subsidised.subsidy?.subsidyId ?? null,
    subsidyRate: money(subsidised.subsidy?.rate ?? 0),
    subsidyAmount: money(subsidised.subsidyAmount),
  };
}

/** A subsidy as a POS or a screen reads it: plain numbers, with the car that earned it. */
export function presentSaleSubsidy(subsidised: SubsidisedSale) {
  return {
    subsidyAmount: Number(subsidised.subsidyAmount),
    subsidy: subsidised.subsidy && {
      id: subsidised.subsidy.subsidyId,
      rate: Number(subsidised.subsidy.rate),
      amount: Number(subsidised.subsidy.amount),
      car: subsidised.subsidy.car,
    },
  };
}
