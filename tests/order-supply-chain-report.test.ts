import { describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "../prisma/generated/prisma/client.js";
import { OrderReportRepository } from "../src/reports/orders/order.report.repository.js";

const dec = (value: number) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(iso);

type Options = {
  cargoStatus?: string;
  /** Each entry is one load: the stock index it draws from, and how much. */
  loads?: { stock: number; quantity: number }[];
  nominationQuantity?: number;
  withPfi?: boolean;
  withT1?: boolean;
  withCustoms?: boolean;
  /** A second nomination, to prove each is reported once. */
  secondNomination?: boolean;
};

/**
 * The graph the repository reads, shaped as Prisma returns it: a nomination is
 * nested under every stock it loads from, so the same one appears repeatedly.
 */
function graph(options: Options = {}) {
  const {
    cargoStatus = "approved",
    loads = [
      { stock: 0, quantity: 450 },
      { stock: 1, quantity: 400 },
      { stock: 1, quantity: 100 },
    ],
    nominationQuantity = 950,
    withPfi = true,
    withT1 = true,
    withCustoms = true,
    secondNomination = false,
  } = options;

  const nomination = (id: string, quantity: number) => ({
    id,
    destination: "Kigali",
    ambQuantity: dec(quantity),
    expectedLoadingDate: at("2026-09-25T00:00:00.000Z"),
    createdAt: at("2026-09-24T10:05:00.000Z"),
    driverVehicle: {
      driver: { id: "dr1", names: "uwimana christian", phone: "0784103864", passport: null, lisence: null },
      vechile: {
        id: "ve1", platNumber: "RAB2234C", model: null, truckNumber: null,
        trailerNumber: null, tankCapacity: dec(40000),
      },
    },
    pfis: withPfi
      ? [{
          id: `pfi-${id}`, pifCode: "PFI7A5351954F", pfiReference: "PFIfff099",
          currancyCode: "RWF", unitPrice: dec(595), amount: dec(200),
          supportingDocUrl: null, createdAt: at("2026-09-24T10:28:00.000Z"),
        }]
      : [],
    t1Validations: withT1
      ? [{
          id: `t1-${id}`, exportingCountry: "Rwanda", quantityAt20C: dec(945),
          supportingDocUrl: null, createdAt: at("2026-09-24T12:21:00.000Z"),
          extraValidations: withCustoms
            ? [{
                id: "cx1", customOffice: "KANAMBO", status: "confirmed",
                createdAt: at("2026-09-24T12:21:00.000Z"), updatedAt: at("2026-09-24T12:22:00.000Z"),
              }]
            : [],
          centralStocks: [{
            id: "cs1", receiptNumber: "RC-1", ambQuantity: dec(950), quantityAt20C: dec(945),
            createdAt: at("2026-09-24T12:23:00.000Z"),
            deport: { id: "dp9", name: "KABUYE", location: "KIGALI" },
          }],
        }]
      : [],
    timeLine: [
      { createdAt: at("2026-09-24T10:05:00.000Z"), timeLineStatus: { status: "awaiting", level: 1 }, user: { firstName: "System", lastName: "Administrator" } },
      { createdAt: at("2026-09-24T10:28:00.000Z"), timeLineStatus: { status: "underLoading", level: 2 }, user: null },
      { createdAt: at("2026-09-24T12:23:00.000Z"), timeLineStatus: { status: "stockReceived", level: 5 }, user: { firstName: "System", lastName: "Administrator" } },
    ],
  });

  const stocks = [0, 1].map((index) => ({
    id: `st${index}`,
    quantity: dec(500),
    receivedDate: at("2026-09-23T12:45:00.000Z"),
    status: "received",
    createdAt: at("2026-09-23T12:45:00.000Z"),
    nominationVessels: loads
      .filter((load) => load.stock === index)
      .map((load, loadIndex) => ({
        id: `v${index}-${loadIndex}`,
        ambQuantity: dec(load.quantity),
        createdAt: at("2026-09-24T10:06:00.000Z"),
        nomination: nomination("nom-1", nominationQuantity),
      }))
      .concat(
        secondNomination && index === 1
          ? [{
              id: `v${index}-extra`,
              ambQuantity: dec(20),
              createdAt: at("2026-09-24T11:00:00.000Z"),
              nomination: nomination("nom-2", 20),
            }]
          : [],
      ),
  }));

  return {
    id: "order-1",
    orderCode: "ORD-DAA1E940E71D",
    orderDate: at("2026-09-23T00:00:00.000Z"),
    quantity: dec(1000),
    createdAt: at("2026-09-23T08:33:00.000Z"),
    updatedAt: at("2026-09-23T08:33:00.000Z"),
    item: { id: "i1", name: "AGO", descriptions: null, status: "active", baseUnit: { id: "u1", name: "Litre", code: "L" } },
    supplier: { id: "s1", name: "YYUSSA", address: null, phone: null, tinNumber: null, status: "active" },
    plan: { id: "p1", name: "First Month", status: "active", startDate: at("2026-09-01T00:00:00.000Z"), endDate: at("2026-09-30T00:00:00.000Z") },
    createdUser: { id: "u9", firstName: "System", lastName: "Administrator" },
    cargos: [
      {
        id: "c0", vesselName: "Vessel N-T", blRef: "7uuytt", tansisRef: null, outurnRef: null,
        quantityInKg: dec(23), quantityInLitre: dec(500), status: cargoStatus,
        receivedDate: at("2026-09-23T12:26:00.000Z"), expirationDate: at("2026-12-23T00:00:00.000Z"),
        supportingDocUrl: null, createdAt: at("2026-09-23T12:26:00.000Z"),
        deport: { id: "d1", name: "DR", location: "Dar es Salaam", type: "foreign", status: "active" },
        cargoInvoices: [{
          id: "inv1", invoiceCode: "INV-1", invoiceReference: "REF-1", quantity: dec(500),
          unitPrice: dec(1200), amount: dec(600000), currencyCode: "RWF",
          supportingDocUrl: null, createdAt: at("2026-09-23T13:00:00.000Z"),
        }],
        stocks: [stocks[0]],
      },
      {
        id: "c1", vesselName: "Vessel N-K", blRef: "reggr", tansisRef: null, outurnRef: null,
        quantityInKg: dec(26), quantityInLitre: dec(500), status: cargoStatus,
        receivedDate: at("2026-09-23T12:28:00.000Z"), expirationDate: at("2026-12-23T00:00:00.000Z"),
        supportingDocUrl: null, createdAt: at("2026-09-23T12:28:00.000Z"),
        deport: { id: "d1", name: "DR", location: "Dar es Salaam", type: "foreign", status: "active" },
        cargoInvoices: [],
        stocks: [stocks[1]],
      },
    ],
  };
}

/** The repository only ever calls `order.findFirst`, so that is all it needs. */
const repositoryFor = (order: unknown) =>
  new OrderReportRepository({
    order: { findFirst: async () => order },
  } as unknown as PrismaClient);

describe("order supply-chain report", () => {
  it("reconciles a complete supply chain", async () => {
    const report = await repositoryFor(graph()).getOrderDetails("order-1");

    expect(report?.summary).toMatchObject({
      ordered: 1000,
      cargoLitres: 1000,
      cargoKg: 49,
      stockReceived: 1000,
      nominated: 950,
      freeToNominate: 50,
      t1ValidatedAt20C: 945,
      nominationVsT1Variance: 5,
      cargoCount: 2,
      nominationCount: 1,
      pfiCount: 1,
      t1Count: 1,
    });
    expect(report?.summary.customsChecks).toEqual({ total: 1, confirmed: 1, pending: 0, cancelled: 0 });
    // The furthest stage reached, not the latest row.
    expect(report?.summary.currentStage).toMatchObject({ status: "stockReceived", level: 5 });
  });

  it("reports a nomination once however many times it loads", async () => {
    const report = await repositoryFor(graph()).getOrderDetails("order-1");

    expect(report?.nominations).toHaveLength(1);
    const [nomination] = report!.nominations;
    // Three loads across two vessels, summing to what it takes from this order.
    expect(nomination.loads).toHaveLength(3);
    expect(nomination.fromThisOrder).toBe(950);
    expect(nomination.loads.map((load) => load.quantity)).toEqual([450, 400, 100]);
    expect(nomination.loads.map((load) => load.vesselName)).toEqual([
      "Vessel N-T", "Vessel N-K", "Vessel N-K",
    ]);

    // And its events are not repeated per load either.
    const events = report!.events;
    expect(events.filter((event) => event.title === "Nomination created")).toHaveLength(1);
    expect(events.filter((event) => event.type === "pfi")).toHaveLength(1);
    expect(events.filter((event) => event.type === "t1")).toHaveLength(1);
    expect(events.filter((event) => event.type === "customs")).toHaveLength(1);
  });

  it("keeps several nominations apart", async () => {
    const report = await repositoryFor(graph({ secondNomination: true })).getOrderDetails("order-1");

    expect(report?.nominations.map((nomination) => nomination.id)).toEqual(["nom-1", "nom-2"]);
    expect(report?.summary.nominated).toBe(970);
    expect(report?.summary.freeToNominate).toBe(30);
  });

  it("leaves the whole order outstanding when nothing is nominated", async () => {
    const report = await repositoryFor(graph({ loads: [] })).getOrderDetails("order-1");

    expect(report?.summary).toMatchObject({
      nominated: 0,
      nominationCount: 0,
      freeToNominate: 1000,
      pfiCount: 0,
      t1Count: 0,
      nominationVsT1Variance: null,
      currentStage: null,
    });
    expect(report?.nominations).toEqual([]);
  });

  it("excludes cancelled cargo from every quantity but still lists it", async () => {
    const report = await repositoryFor(graph({ cargoStatus: "cancelled" })).getOrderDetails("order-1");

    expect(report?.summary).toMatchObject({
      cargoLitres: 0,
      cargoKg: 0,
      stockReceived: 0,
      outstanding: 1000,
      cargoCount: 2,
    });
    expect(report?.summary.cargosByStatus).toEqual({ cancelled: 2 });
    expect(report?.cargos).toHaveLength(2);
  });

  it("survives a chain with no PFI, T1 or customs", async () => {
    const report = await repositoryFor(
      graph({ withPfi: false, withT1: false, withCustoms: false }),
    ).getOrderDetails("order-1");

    expect(report?.summary).toMatchObject({
      pfiCount: 0,
      t1Count: 0,
      t1ValidatedAt20C: 0,
      nominationVsT1Variance: null,
      nominated: 950,
    });
    expect(report?.summary.customsChecks).toEqual({ total: 0, confirmed: 0, pending: 0, cancelled: 0 });
    expect(report?.events.some((event) => event.type === "t1")).toBe(false);
  });

  it("builds one chronological history", async () => {
    const report = await repositoryFor(graph()).getOrderDetails("order-1");
    const events = report!.events;

    const timestamps = events.map((event) => event.at);
    expect([...timestamps].sort()).toEqual(timestamps);
    expect(events[0]).toMatchObject({
      type: "order",
      title: "Order raised",
      by: "System Administrator",
    });
    expect(events.at(-1)).toMatchObject({ type: "centralStock" });
    // Every stage of the chain is represented.
    expect(new Set(events.map((event) => event.type))).toEqual(
      new Set(["order", "cargo", "invoice", "stock", "nomination", "pfi", "t1", "customs", "centralStock"]),
    );
  });

  it("returns nothing for an unknown order", async () => {
    expect(await repositoryFor(null).getOrderDetails("nope")).toBeNull();
  });
});
