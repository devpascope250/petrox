import { describe, expect, it } from "vitest";
import { Prisma } from "../prisma/generated/prisma/client.js";
import { subsidyColumns, subsidyForSale } from "../src/modules/subsidies/subsidy-rules.js";

const decimal = (value: number | string) => new Prisma.Decimal(value);

const SITE = "site-1";
const ITEM = "item-ago";
const CLIENT = "client-1";

type Car = { id: string; plateNo: string };

/**
 * A stand-in for the two queries the rules make, so the gate can be checked
 * without a database: the card assignment, the client's allowed cars, and the
 * subsidy in force. Each records what it was asked, so the filters can be
 * asserted too.
 */
function dbWith(options: {
  /** The car an active card assignment points at, if any. */
  cardCar?: Car | null;
  /** The client's allowed cars for the product, as the filter would return them. */
  cars?: Car[];
  rate?: number | null;
}) {
  const asked: { assignment?: unknown; cars?: unknown; subsidy?: unknown } = {};
  return {
    asked,
    db: {
      clientCarCardAssignment: {
        findFirst: async (args: unknown) => {
          asked.assignment = args;
          return options.cardCar ? { clientCar: options.cardCar } : null;
        },
      },
      clientCar: {
        findMany: async (args: unknown) => {
          asked.cars = args;
          return options.cars ?? [];
        },
      },
      subsidy: {
        findFirst: async (args: unknown) => {
          asked.subsidy = args;
          return options.rate === null || options.rate === undefined
            ? null
            : { id: "sub-1", rate: decimal(options.rate) };
        },
      },
    } as never,
  };
}

const sale = { itemId: ITEM, siteId: SITE, quantity: decimal("11.34"), clientId: CLIENT };

describe("the subsidy a sale earns", () => {
  it("is a fixed amount for each unit sold, not a percentage", async () => {
    const { db } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 240 });
    const subsidised = await subsidyForSale(db, { ...sale, cardCopyId: 7n });

    // 11.34 litres at 240 a litre.
    expect(subsidised.subsidyAmount.toString()).toBe("2721.6");
    expect(subsidised.subsidy?.rate.toString()).toBe("240");
    expect(subsidised.subsidy?.car).toEqual({ id: "car-1", plateNo: "RAD 123 A" });
  });

  it("finds the car by the plate when no card was used", async () => {
    const { db } = dbWith({ cars: [{ id: "car-2", plateNo: "RAD-456-B" }], rate: 100 });
    // Written differently at the pump: spacing and case do not matter.
    const subsidised = await subsidyForSale(db, { ...sale, platNumber: "rad 456b" });

    expect(subsidised.subsidy?.car.id).toBe("car-2");
    expect(subsidised.subsidyAmount.toString()).toBe("1134");
  });

  it("gives nothing when the plate is not one of the client's allowed cars", async () => {
    const { db } = dbWith({ cars: [{ id: "car-2", plateNo: "RAD 456 B" }], rate: 100 });
    const subsidised = await subsidyForSale(db, { ...sale, platNumber: "RAD 999 Z" });

    expect(subsidised.subsidy).toBeNull();
    expect(subsidised.subsidyAmount.toString()).toBe("0");
  });

  it("asks only for the client's own active cars that are allowed and take this product", async () => {
    const { db, asked } = dbWith({ cars: [], rate: 240 });
    await subsidyForSale(db, { ...sale, platNumber: "RAD 123 A" });

    expect(asked.cars).toMatchObject({
      // The client's own flag is part of the same query.
      where: { clientId: CLIENT, itemId: ITEM, status: "active", subsidyAllowed: true,
        client: { subsidyAllowed: true } },
    });
  });

  it("asks for the client's flag on the card route too", async () => {
    const { db, asked } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 240 });
    await subsidyForSale(db, { ...sale, cardCopyId: 7n });

    expect(asked.assignment).toMatchObject({
      where: { cardCopyId: 7n, status: "active", unassignedAt: null,
        clientCar: { clientId: CLIENT, subsidyAllowed: true, client: { subsidyAllowed: true } } },
    });
  });

  it("gives nothing to a sale with no client, so a walk-in never earns one", async () => {
    const { db, asked } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 240 });
    const subsidised = await subsidyForSale(db, { ...sale, clientId: null, platNumber: "RAD 123 A" });

    expect(subsidised.subsidy).toBeNull();
    // And nothing was looked up at all.
    expect(asked).toEqual({});
  });

  it("gives nothing when the car is not identified", async () => {
    const { db } = dbWith({ cardCar: null, rate: 240 });
    const subsidised = await subsidyForSale(db, { ...sale, cardCopyId: 7n });

    expect(subsidised.subsidy).toBeNull();
  });

  it("gives nothing when no subsidy is in force for the product", async () => {
    const { db } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: null });
    const subsidised = await subsidyForSale(db, { ...sale, cardCopyId: 7n });

    expect(subsidised.subsidy).toBeNull();
    expect(subsidised.subsidyAmount.toString()).toBe("0");
  });

  it("ignores a rate of zero", async () => {
    const { db } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 0 });
    expect((await subsidyForSale(db, { ...sale, cardCopyId: 7n })).subsidy).toBeNull();
  });

  it("prefers this site's rate over the company-wide one", async () => {
    const { db, asked } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 240 });
    await subsidyForSale(db, { ...sale, cardCopyId: 7n });

    expect(asked.subsidy).toMatchObject({
      where: { itemId: ITEM, status: "active", OR: [{ siteId: SITE }, { siteId: null }] },
      orderBy: [{ siteId: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    });
  });

  it("copies the rate onto the sale, so editing the subsidy cannot rewrite it", async () => {
    const { db } = dbWith({ cardCar: { id: "car-1", plateNo: "RAD 123 A" }, rate: 240 });
    const columns = subsidyColumns(await subsidyForSale(db, { ...sale, cardCopyId: 7n }));

    expect(columns.subsidyId).toBe("sub-1");
    expect(columns.subsidyRate.toString()).toBe("240");
    expect(columns.subsidyAmount.toString()).toBe("2721.6");
  });

  it("records nothing at all when nothing applies", async () => {
    const { db } = dbWith({});
    const columns = subsidyColumns(await subsidyForSale(db, { ...sale, platNumber: "RAD 1 A" }));

    expect(columns).toEqual({ subsidyId: null, subsidyRate: decimal("0.00"), subsidyAmount: decimal("0.00") });
  });
});
