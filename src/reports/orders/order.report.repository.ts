import { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";

const num = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
const round = (value: number) => Math.round(value * 100) / 100;
const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

/** Cargo that never arrived must not count towards any quantity. */
const isLive = (status: string) => status !== "cancelled";

type Event = {
  at: string;
  type:
    | "order"
    | "cargo"
    | "invoice"
    | "stock"
    | "nomination"
    | "pfi"
    | "t1"
    | "customs"
    | "centralStock";
  title: string;
  detail: string | null;
  by: string | null;
};

/**
 * The whole supply chain behind one order, as a reporting view rather than the
 * database graph.
 *
 * A nomination is reachable through every cargo and stock it loads from, so the
 * raw tree repeats it once per load. This builds three views of the same read:
 *
 * - `cargos` — the tree, for the cargo and stock tables;
 * - `nominations` — each nomination **once**, with its loads broken out;
 * - `summary` and `events` — the order's totals and a dated history.
 *
 * Every quantity is computed here, once, so the drawer, the printout and the
 * workbook cannot disagree about what was ordered, received or nominated.
 */
export class OrderReportRepository {
  constructor(private db: PrismaClient) {}

  getOrderDetails = async (id: string) => {
    const order = await this.db.order.findFirst({
      where: { id },
      select: {
        id: true,
        orderCode: true,
        orderDate: true,
        quantity: true,
        createdAt: true,
        updatedAt: true,
        item: {
          select: {
            id: true,
            name: true,
            descriptions: true,
            status: true,
            baseUnit: { select: { id: true, name: true, code: true } },
          },
        },
        supplier: {
          select: { id: true, name: true, address: true, phone: true, tinNumber: true, status: true },
        },
        plan: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
        createdUser: { select: { id: true, firstName: true, lastName: true } },
        cargos: {
          orderBy: { receivedDate: "asc" },
          select: {
            id: true,
            vesselName: true,
            blRef: true,
            tansisRef: true,
            outurnRef: true,
            quantityInKg: true,
            quantityInLitre: true,
            status: true,
            receivedDate: true,
            expirationDate: true,
            supportingDocUrl: true,
            createdAt: true,
            deport: { select: { id: true, name: true, location: true, type: true, status: true } },
            cargoInvoices: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                invoiceCode: true,
                invoiceReference: true,
                quantity: true,
                unitPrice: true,
                amount: true,
                currencyCode: true,
                supportingDocUrl: true,
                createdAt: true,
              },
            },
            stocks: {
              orderBy: { receivedDate: "asc" },
              select: {
                id: true,
                quantity: true,
                receivedDate: true,
                status: true,
                createdAt: true,
                nominationVessels: {
                  orderBy: { createdAt: "asc" },
                  select: {
                    id: true,
                    ambQuantity: true,
                    createdAt: true,
                    nomination: {
                      select: {
                        id: true,
                        destination: true,
                        ambQuantity: true,
                        expectedLoadingDate: true,
                        createdAt: true,
                        driverVehicle: {
                          select: {
                            driver: {
                              select: { id: true, names: true, phone: true, passport: true, lisence: true },
                            },
                            vechile: {
                              select: {
                                id: true,
                                platNumber: true,
                                model: true,
                                truckNumber: true,
                                trailerNumber: true,
                                tankCapacity: true,
                              },
                            },
                          },
                        },
                        pfis: {
                          orderBy: { createdAt: "asc" },
                          select: {
                            id: true,
                            pifCode: true,
                            pfiReference: true,
                            currancyCode: true,
                            unitPrice: true,
                            amount: true,
                            supportingDocUrl: true,
                            createdAt: true,
                          },
                        },
                        t1Validations: {
                          orderBy: { createdAt: "asc" },
                          select: {
                            id: true,
                            exportingCountry: true,
                            quantityAt20C: true,
                            supportingDocUrl: true,
                            createdAt: true,
                            extraValidations: {
                              orderBy: { createdAt: "asc" },
                              select: {
                                id: true,
                                customOffice: true,
                                status: true,
                                createdAt: true,
                                updatedAt: true,
                              },
                            },
                            centralStocks: {
                              orderBy: { createdAt: "asc" },
                              select: {
                                id: true,
                                receiptNumber: true,
                                ambQuantity: true,
                                quantityAt20C: true,
                                createdAt: true,
                                deport: { select: { id: true, name: true, location: true } },
                              },
                            },
                          },
                        },
                        timeLine: {
                          orderBy: { createdAt: "asc" },
                          select: {
                            createdAt: true,
                            timeLineStatus: { select: { status: true, level: true } },
                            user: { select: { firstName: true, lastName: true } },
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
    if (!order) return order;

    const fullName = (user: { firstName: string; lastName: string } | null | undefined) =>
      user ? `${user.firstName} ${user.lastName}`.trim() : null;
    const raisedBy = fullName(order.createdUser);
    const unit = order.item?.baseUnit?.code ?? "";
    const withUnit = (quantity: number) => `${quantity.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;

    const events: Event[] = [
      {
        at: order.createdAt.toISOString(),
        type: "order",
        title: "Order raised",
        detail: `${withUnit(num(order.quantity))} ${order.item?.name ?? ""} from ${order.supplier?.name ?? "supplier"}`.trim(),
        by: raisedBy,
      },
    ];

    /** Each nomination once, keyed by id, with a load per vessel row. */
    const nominations = new Map<string, {
      id: string;
      destination: string;
      ambQuantity: number;
      expectedLoadingDate: string | null;
      createdAt: string;
      fromThisOrder: number;
      driverVehicle: unknown;
      pfis: unknown[];
      t1Validations: unknown[];
      loads: Array<{
        vesselId: string;
        stockId: string;
        cargoId: string;
        vesselName: string;
        blRef: string;
        quantity: number;
        loadedAt: string;
      }>;
      stage: { status: string; level: number; at: string; by: string | null } | null;
      timeLine: Array<{ status: string; level: number; at: string; by: string | null }>;
    }>();

    let cargoLitres = 0;
    let cargoKg = 0;
    let stockReceived = 0;
    let invoiceCount = 0;
    let invoicedQuantity = 0;
    const cargosByStatus: Record<string, number> = {};
    const invoicedByCurrency: Record<string, number> = {};

    const cargos = order.cargos.map((cargo) => {
      cargosByStatus[cargo.status] = (cargosByStatus[cargo.status] ?? 0) + 1;
      const counts = isLive(cargo.status);
      if (counts) {
        cargoLitres += num(cargo.quantityInLitre);
        cargoKg += num(cargo.quantityInKg);
      }

      events.push({
        at: cargo.createdAt.toISOString(),
        type: "cargo",
        title: cargo.status === "cancelled" ? "Cargo cancelled" : "Cargo recorded",
        detail: `${cargo.vesselName}${cargo.blRef ? ` · BL ${cargo.blRef}` : ""} · ${num(cargo.quantityInLitre).toLocaleString("en-US")} L`,
        by: null,
      });

      for (const invoice of cargo.cargoInvoices) {
        invoiceCount += 1;
        invoicedQuantity += num(invoice.quantity);
        invoicedByCurrency[invoice.currencyCode] = round(
          (invoicedByCurrency[invoice.currencyCode] ?? 0) + num(invoice.amount),
        );
        events.push({
          at: invoice.createdAt.toISOString(),
          type: "invoice",
          title: "Supplier invoice",
          detail: `${invoice.invoiceCode} · ${num(invoice.amount).toLocaleString("en-US")} ${invoice.currencyCode} · ${cargo.vesselName}`,
          by: null,
        });
      }

      const stocks = cargo.stocks.map((stock) => {
        if (counts) stockReceived += num(stock.quantity);
        events.push({
          at: stock.createdAt.toISOString(),
          type: "stock",
          title: "Stock received",
          detail: `${withUnit(num(stock.quantity))} from ${cargo.vesselName}`,
          by: null,
        });

        // The tree keeps one entry per load, which is what the cargo and stock
        // tables read; `nominations` below carries each nomination once.
        const stockNominations = stock.nominationVessels.map(({ nomination, ...vessel }) => {
          let entry = nominations.get(nomination.id);
          if (!entry) {
            const timeLine = nomination.timeLine.map((stage) => ({
              status: stage.timeLineStatus.status,
              level: stage.timeLineStatus.level,
              at: stage.createdAt.toISOString(),
              by: fullName(stage.user),
            }));
            // The furthest stage reached, not merely the most recent entry.
            const stage = timeLine.reduce<(typeof timeLine)[number] | null>(
              (furthest, candidate) =>
                !furthest || candidate.level > furthest.level ? candidate : furthest,
              null,
            );
            entry = {
              id: nomination.id,
              destination: nomination.destination,
              ambQuantity: num(nomination.ambQuantity),
              expectedLoadingDate: iso(nomination.expectedLoadingDate),
              createdAt: nomination.createdAt.toISOString(),
              fromThisOrder: 0,
              driverVehicle: nomination.driverVehicle,
              pfis: nomination.pfis.map((pfi) => ({
                ...pfi,
                unitPrice: num(pfi.unitPrice),
                amount: num(pfi.amount),
                createdAt: pfi.createdAt.toISOString(),
              })),
              t1Validations: nomination.t1Validations.map((t1) => ({
                ...t1,
                quantityAt20C: num(t1.quantityAt20C),
                createdAt: t1.createdAt.toISOString(),
                centralStocks: t1.centralStocks.map((central) => ({
                  ...central,
                  ambQuantity: num(central.ambQuantity),
                  quantityAt20C: num(central.quantityAt20C),
                })),
              })),
              loads: [],
              stage,
              timeLine,
            };
            nominations.set(nomination.id, entry);

            events.push({
              at: entry.createdAt,
              type: "nomination",
              title: "Nomination created",
              detail: `${withUnit(entry.ambQuantity)} → ${nomination.destination}${
                nomination.driverVehicle?.vechile?.platNumber
                  ? ` · ${nomination.driverVehicle.vechile.platNumber}`
                  : ""
              }`,
              by: timeLine[0]?.by ?? null,
            });
            // Stage changes after the first, which is the nomination itself.
            for (const stageEntry of timeLine.slice(1)) {
              events.push({
                at: stageEntry.at,
                type: "nomination",
                title: `Nomination ${stageEntry.status}`,
                detail: `${nomination.destination}${
                  nomination.driverVehicle?.vechile?.platNumber
                    ? ` · ${nomination.driverVehicle.vechile.platNumber}`
                    : ""
                }`,
                by: stageEntry.by,
              });
            }
            for (const pfi of nomination.pfis) {
              events.push({
                at: pfi.createdAt.toISOString(),
                type: "pfi",
                title: "PFI raised",
                detail: `${pfi.pifCode} · ${num(pfi.amount).toLocaleString("en-US")} ${pfi.currancyCode}`,
                by: null,
              });
            }
            for (const t1 of nomination.t1Validations) {
              events.push({
                at: t1.createdAt.toISOString(),
                type: "t1",
                title: "T1 validation",
                detail: `${num(t1.quantityAt20C).toLocaleString("en-US")}${unit ? ` ${unit}` : ""} at 20 °C · ${t1.exportingCountry}`,
                by: null,
              });
              for (const check of t1.extraValidations) {
                events.push({
                  // A check is raised, then settled; the settling is the news.
                  at: (check.status === "pending" ? check.createdAt : check.updatedAt).toISOString(),
                  type: "customs",
                  title: `Customs ${check.status}`,
                  detail: check.customOffice,
                  by: null,
                });
              }
              for (const central of t1.centralStocks) {
                events.push({
                  at: central.createdAt.toISOString(),
                  type: "centralStock",
                  title: "Taken into central stock",
                  detail: `${num(central.quantityAt20C).toLocaleString("en-US")}${unit ? ` ${unit}` : ""} at ${central.deport.name}${
                    central.receiptNumber ? ` · receipt ${central.receiptNumber}` : ""
                  }`,
                  by: null,
                });
              }
            }
          }

          const quantity = num(vessel.ambQuantity);
          entry.fromThisOrder = round(entry.fromThisOrder + quantity);
          entry.loads.push({
            vesselId: vessel.id,
            stockId: stock.id,
            cargoId: cargo.id,
            vesselName: cargo.vesselName,
            blRef: cargo.blRef,
            quantity,
            loadedAt: vessel.createdAt.toISOString(),
          });

          return {
            ...nomination,
            ambQuantity: num(nomination.ambQuantity),
            vesselId: vessel.id,
            vesselQuantity: quantity,
            pfis: entry.pfis,
            t1Validations: entry.t1Validations,
          };
        });

        return {
          ...stock,
          quantity: num(stock.quantity),
          nominations: stockNominations,
        };
      });

      return {
        ...cargo,
        quantityInKg: num(cargo.quantityInKg),
        quantityInLitre: num(cargo.quantityInLitre),
        stocks,
      };
    });

    const nominationRows = Array.from(nominations.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const pfiAmountByCurrency: Record<string, number> = {};
    let pfiCount = 0;
    let t1Count = 0;
    let t1ValidatedAt20C = 0;
    const customsChecks = { total: 0, confirmed: 0, pending: 0, cancelled: 0 };

    for (const nomination of nominationRows) {
      for (const pfi of nomination.pfis as Array<{ amount: number; currancyCode: string }>) {
        pfiCount += 1;
        pfiAmountByCurrency[pfi.currancyCode] = round(
          (pfiAmountByCurrency[pfi.currancyCode] ?? 0) + pfi.amount,
        );
      }
      for (const t1 of nomination.t1Validations as Array<{
        quantityAt20C: number;
        extraValidations: Array<{ status: string }>;
      }>) {
        t1Count += 1;
        t1ValidatedAt20C = round(t1ValidatedAt20C + t1.quantityAt20C);
        for (const check of t1.extraValidations) {
          customsChecks.total += 1;
          if (check.status === "confirmed") customsChecks.confirmed += 1;
          else if (check.status === "cancelled") customsChecks.cancelled += 1;
          else customsChecks.pending += 1;
        }
      }
    }

    const ordered = num(order.quantity);
    const nominated = round(
      nominationRows.reduce((total, nomination) => total + nomination.fromThisOrder, 0),
    );
    // The furthest stage any of this order's nominations has reached.
    const currentStage = nominationRows.reduce<
      { status: string; level: number; at: string; by: string | null } | null
    >(
      (furthest, nomination) =>
        nomination.stage && (!furthest || nomination.stage.level > furthest.level)
          ? nomination.stage
          : furthest,
      null,
    );

    return {
      ...order,
      quantity: ordered,
      cargos,
      nominations: nominationRows,
      summary: {
        ordered,
        cargoCount: order.cargos.length,
        cargosByStatus,
        cargoLitres: round(cargoLitres),
        cargoKg: round(cargoKg),
        // What was ordered but has not arrived as cargo yet.
        outstanding: round(ordered - cargoLitres),
        invoiceCount,
        invoicedQuantity: round(invoicedQuantity),
        invoicedByCurrency,
        stockReceived: round(stockReceived),
        nominated,
        // What is in stock off this order and not yet spoken for.
        freeToNominate: round(stockReceived - nominated),
        nominationCount: nominationRows.length,
        pfiCount,
        pfiAmountByCurrency,
        t1Count,
        t1ValidatedAt20C,
        /**
         * Nominated against what customs validated at 20 °C. Reported even when
         * it is not zero — a gap here is the point of the reconciliation, not
         * something to round away.
         */
        nominationVsT1Variance: t1Count === 0 ? null : round(nominated - t1ValidatedAt20C),
        customsChecks,
        currentStage,
      },
      events: events.sort((a, b) => a.at.localeCompare(b.at)),
    };
  };
}
