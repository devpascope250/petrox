import { Prisma, PrismaClient } from "../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../shared/pagination/index.js";
import { presentFees, reportFeeSelect, sumFeeTotals } from "../modules/fees/fee.repository.js";
import {
  CentralStockReportQuery,
  CentralStockInventoryQuery,
  CentralStockTransactionReportQuery,
  ReportOrderQuery,
} from "./report.schema.js";

const zero = () => new Prisma.Decimal(0);
const num = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
const round = (value: number) => Math.round(value * 100) / 100;

export type ToleranceOutcome = "gain" | "loss" | "balanced";
export type ToleranceStatus =
  | "withinTolerance"
  | "exceededGain"
  | "exceededLoss"
  | "notAssessed";
/**
 * Which declared quantity a receipt was measured against. `t1Validated` is the
 * official basis; `nominated` is the fallback used while a T1 validation has no
 * quantity recorded on it, so receipts are still graded instead of skipped.
 */
export type ToleranceBasis = "t1Validated" | "nominated";

export class ReportRepository {
  constructor(private db: PrismaClient) {}

  private orderWhere(
    query: ReportOrderQuery,
    options: { byCargoDeport?: boolean } = {},
  ): Prisma.OrderWhereInput {
    const { byCargoDeport = true } = options;
    return {
      orderDate: { gte: query.startDate, lte: query.endDate },
      ...(query.byOrderPlanId && { orderPlanId: query.byOrderPlanId }),
      ...(query.bySupplierId && { supplierId: query.bySupplierId }),
      ...(byCargoDeport &&
        query.deportId && { cargos: { some: { deportId: query.deportId } } }),
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.orderCode && { orderCode: { contains: query.orderCode } }),
    };
  }

  /**
   * The quantity a receipt should have delivered. Prefers the T1-validated
   * figure; falls back to the nominated quantity when the T1 carries none, so
   * receipts still get graded rather than dropping out of the report.
   */
  private expectedQuantity(
    t1Quantity: Prisma.Decimal | null,
    nominatedQuantity: Prisma.Decimal | null,
  ): { quantity: number; basis: ToleranceBasis } {
    const validated = num(t1Quantity);
    return validated > 0
      ? { quantity: validated, basis: "t1Validated" }
      : { quantity: num(nominatedQuantity), basis: "nominated" };
  }

  /**
   * Compares what a receipt was expected to deliver against what it actually
   * delivered, and grades the gap against the tolerance rate allowed for it.
   */
  private assessTolerance(
    expected: number,
    actual: number,
    rate: number | null,
    basis: ToleranceBasis = "t1Validated",
  ) {
    const variance = round(actual - expected);
    const outcome: ToleranceOutcome =
      variance > 0 ? "gain" : variance < 0 ? "loss" : "balanced";
    const allowedVariance =
      rate === null || expected <= 0 ? null : round((expected * rate) / 100);
    const status: ToleranceStatus =
      allowedVariance === null
        ? "notAssessed"
        : Math.abs(variance) <= allowedVariance
          ? "withinTolerance"
          : outcome === "gain"
            ? "exceededGain"
            : "exceededLoss";
    return {
      basis,
      expectedQuantity: round(expected),
      actualQuantity: round(actual),
      variance,
      variancePct: expected > 0 ? round((variance / expected) * 100) : null,
      outcome,
      allowedRate: rate,
      allowedVariance,
      exceededBy:
        allowedVariance === null || status === "withinTolerance"
          ? 0
          : round(Math.abs(variance) - allowedVariance),
      status,
      withinTolerance: status === "withinTolerance",
    };
  }

  async supplyChainOrderSummary(query: ReportOrderQuery) {
    const where = this.orderWhere(query);
    const [orders, cargos] = await this.db.$transaction([
      this.db.order.aggregate({
        where,
        _count: { _all: true },
        _sum: { quantity: true },
      }),
      this.db.cargo.groupBy({
        by: ["status"],
        where: {
          order: where,
          ...(query.deportId && { deportId: query.deportId }),
        },
        orderBy: { status: "asc" },
        _count: true,
        _sum: { quantityInKg: true, quantityInLitre: true },
      }),
    ]);
    const cargoTotals = cargos as unknown as Array<{
      status: (typeof cargos)[number]["status"];
      _count: number;
      _sum: { quantityInKg: Prisma.Decimal | null; quantityInLitre: Prisma.Decimal | null };
    }>;
    return {
      totalOrders: orders._count._all,
      totalOrderedQuantity: num(orders._sum.quantity),
      totalCargos: cargoTotals.reduce((sum, row) => sum + row._count, 0),
      totalCargoQuantityInLittre: cargoTotals
        .reduce((sum, row) => sum.plus(row._sum.quantityInLitre ?? 0), zero())
        .toNumber(),
      totalCargoQuantityInKg: cargoTotals
        .reduce((sum, row) => sum.plus(row._sum.quantityInKg ?? 0), zero())
        .toNumber(),
      cargosByStatus: Object.fromEntries(
        cargoTotals.map((row) => [
          row.status,
          {
            count: row._count,
            quantityInKg: num(row._sum.quantityInKg),
            quantityInLittre: num(row._sum.quantityInLitre),
          },
        ]),
      ),
    };
  }

  async supplyChainOrderDetails(query: ReportOrderQuery) {
    const where = this.orderWhere(query);
    const [rows, total] = await this.db.$transaction([
      this.db.order.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ orderDate: "desc" }, { id: "desc" }],
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
            select: {
              id: true,
              name: true,
              supplierType: true,
              tinNumber: true,
              phone: true,
              address: true,
              status: true,
            },
          },
          plan: {
            select: {
              id: true,
              name: true,
              status: true,
              startDate: true,
              endDate: true,
            },
          },
          createdUser: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          cargos: {
            where: query.deportId ? { deportId: query.deportId } : undefined,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
              deport: {
                select: {
                  id: true,
                  name: true,
                  location: true,
                  type: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      this.db.order.count({ where }),
    ]);
    return paginatedData(
      rows.map((row) => ({
        ...row,
        quantity: num(row.quantity),
        cargos: row.cargos.map((cargo) => ({
          ...cargo,
          quantityInKg: num(cargo.quantityInKg),
          quantityInLitre: num(cargo.quantityInLitre),
        })),
      })),
      total,
      query,
    );
  }

  async supplyChainOrdersBySupplier(query: ReportOrderQuery) {
    const orderWhere = this.orderWhere(query);
    const where: Prisma.SupplierWhereInput = { orders: { some: orderWhere } };
    const [rows, total] = await this.db.$transaction([
      this.db.supplier.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          status: true,
          supplierType: true,
          tinNumber: true,
          orders: {
            where: orderWhere,
            select: {
              quantity: true,
              cargos: {
                where: query.deportId
                  ? { deportId: query.deportId }
                  : undefined,
                select: { quantityInKg: true, quantityInLitre: true },
              },
            },
          },
        },
      }),
      this.db.supplier.count({ where }),
    ]);
    return paginatedData(
      rows.map(({ orders, ...supplier }) => ({
        ...supplier,
        totalOrders: orders.length,
        orderedQuantity: orders
          .reduce((sum, row) => sum.plus(row.quantity), zero())
          .toNumber(),
        receivedQuantityAt20C: orders
          .flatMap((row) => row.cargos)
          .reduce((sum, row) => sum.plus(row.quantityInLitre), zero())
          .toNumber(),
      })),
      total,
      query,
    );
  }

  async supplyChainOrdersByItem(query: ReportOrderQuery) {
    const orderWhere = this.orderWhere(query);
    const where: Prisma.ItemWhereInput = { orders: { some: orderWhere } };
    const [rows, total] = await this.db.$transaction([
      this.db.item.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          descriptions: true,
          status: true,
          createdAt: true,
          baseUnit: { select: { id: true, name: true, code: true } },
          toleranceRates: true,
          orders: {
            where: orderWhere,
            select: {
              quantity: true,
              cargos: {
                where: query.deportId
                  ? { deportId: query.deportId }
                  : undefined,
                select: { quantityInLitre: true },
              },
            },
          },
        },
      }),
      this.db.item.count({ where }),
    ]);
    return paginatedData(
      rows.map(({ orders, ...item }) => ({
        ...item,
        totalOrders: orders.length,
        orderedQuantity: orders
          .reduce((sum, row) => sum.plus(row.quantity), zero())
          .toNumber(),
        receivedQuantityAt20C: orders
          .flatMap((row) => row.cargos)
          .reduce((sum, row) => sum.plus(row.quantityInLitre), zero())
          .toNumber(),
      })),
      total,
      query,
    );
  }

  async supplyChainOrdersByDeport(query: ReportOrderQuery) {
    const orderWhere = this.orderWhere(query);
    const where: Prisma.DeportWhereInput = {
      ...(query.deportId && { id: query.deportId }),
      cargos: { some: { order: orderWhere } },
    };
    const [rows, total] = await this.db.$transaction([
      this.db.deport.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          status: true,
          type: true,
          location: true,
          createdAt: true,
          cargos: {
            where: { order: orderWhere },
            select: { quantityInLitre: true, quantityInKg: true, status: true },
          },
        },
      }),
      this.db.deport.count({ where }),
    ]);
    return paginatedData(
      rows.map(({ cargos, ...depot }) => ({
        ...depot,
        totalCargos: cargos.length,
        quantityInKg: cargos
          .reduce((sum, row) => sum.plus(row.quantityInKg), zero())
          .toNumber(),
        quantityInLittre: cargos
          .reduce((sum, row) => sum.plus(row.quantityInLitre), zero())
          .toNumber(),
        cargosByStatus: Object.fromEntries(
          [...new Set(cargos.map((row) => row.status))].map((status) => [
            status,
            cargos.filter((row) => row.status === status).length,
          ]),
        ),
      })),
      total,
      query,
    );
  }


  /**
   * Tolerance report: for every stock receipt raised against orders in range,
   * measures the T1-validated quantity at 20C against the quantity actually
   * taken into central stock, and flags anything outside the item's allowed
   * tolerance rate. Rows are items; receipts hang underneath them.
   *
   * `deportId` here means the receiving depot, not the cargo's arrival depot.
   */
  async supplyChainOrdersByOrderTolerance(query: ReportOrderQuery) {
    const orderWhere = this.orderWhere(query, { byCargoDeport: false });
    const stockWhere: Prisma.CentralStockWhereInput = {
      ...(query.deportId && { deportId: query.deportId }),
      ...(query.itemId && { itemId: query.itemId }),
      t1Validation: { nomination: { nominationVessels: { some: { stock: { cargo: { order: orderWhere } } } } } },
    };
    const where: Prisma.ItemWhereInput = { centralStocks: { some: stockWhere } };

    const [rows, total, allReceipts, activeRates] = await this.db.$transaction([
      this.db.item.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          descriptions: true,
          status: true,
          baseUnit: { select: { id: true, name: true, code: true } },
          toleranceRates: {
            where: { status: "active" },
            orderBy: { createdAt: "asc" },
            select: { id: true, maxRate: true, status: true, createdAt: true },
          },
          centralStocks: {
            where: stockWhere,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              receiptNumber: true,
              ambQuantity: true,
              quantityAt20C: true,
              toleranceRate: true,
              gainQty: true,
              lossQty: true,
              status: true,
              supportingDocUrl: true,
              createdAt: true,
              deport: {
                select: { id: true, name: true, location: true, type: true },
              },
              t1Validation: {
                select: {
                  id: true,
                  exportingCountry: true,
                  quantityAt20C: true,
                  nomination: {
                    select: {
                      id: true,
                      destination: true,
                      expectedLoadingDate: true,
                      ambQuantity: true,
                      // A nomination can load from several vessels, so every
                      // cargo behind the receipt comes through this list.
                      nominationVessels: {
                        orderBy: { createdAt: "asc" },
                        select: {
                          id: true,
                          stockId: true,
                          ambQuantity: true,
                          stock: {
                            select: {
                              cargo: {
                                select: {
                                  id: true,
                                  blRef: true,
                                  vesselName: true,
                                  tansisRef: true,
                                  outurnRef: true,
                                  order: {
                                    select: {
                                      id: true,
                                      orderCode: true,
                                      orderDate: true,
                                      quantity: true,
                                      supplier: { select: { id: true, name: true } },
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
      }),
      this.db.item.count({ where }),
      // Unpaginated, so the headline summary covers the whole filtered set
      // rather than just the current page of items.
      this.db.centralStock.findMany({
        where: stockWhere,
        select: {
          itemId: true,
          quantityAt20C: true,
          ambQuantity: true,
          toleranceRate: true,
          gainQty: true,
          lossQty: true,
          t1Validation: {
            select: {
              quantityAt20C: true,
              nomination: { select: { ambQuantity: true } },
            },
          },
        },
      }),
      this.db.itemToleranceRate.findMany({
        where: { status: "active", item: where },
        orderBy: { createdAt: "asc" },
        select: { itemId: true, maxRate: true },
      }),
    ]);

    // Latest active rate wins, so a re-configured item is graded on today's rule.
    const rateByItem = new Map(
      activeRates.map((rate) => [rate.itemId, num(rate.maxRate)]),
    );

    const items = rows.map(({ centralStocks, toleranceRates, ...item }) => {
      const itemRate = rateByItem.get(item.id) ?? null;
      const receipts = centralStocks.map(
        ({ t1Validation, deport, ...stock }) => {
          const { nomination } = t1Validation;
          const vessels = nomination.nominationVessels;
          // `order` and `cargo` stay single-valued for existing consumers: the
          // first vessel leads, and `vessels` below carries the full picture.
          // A nomination with no vessel at all cannot be reached through this
          // report's filter, but it is guarded rather than trusted.
          const cargo = vessels[0]?.stock.cargo ?? null;
          const appliedRate =
            stock.toleranceRate === null ? itemRate : num(stock.toleranceRate);
          const expected = this.expectedQuantity(
            t1Validation.quantityAt20C,
            nomination.ambQuantity,
          );
          const atStandard = this.assessTolerance(
            expected.quantity,
            num(stock.quantityAt20C),
            appliedRate,
            expected.basis,
          );
          return {
            id: stock.id,
            receiptNumber: stock.receiptNumber,
            stockStatus: stock.status,
            supportingDocUrl: stock.supportingDocUrl,
            receivedAt: stock.createdAt,
            depot: deport,
            order: cargo
              ? { ...cargo.order, quantity: num(cargo.order.quantity) }
              : null,
            cargo: cargo
              ? {
                  id: cargo.id,
                  blRef: cargo.blRef,
                  vesselName: cargo.vesselName,
                  tansisRef: cargo.tansisRef,
                  outurnRef: cargo.outurnRef,
                }
              : null,
            nomination: {
              id: nomination.id,
              destination: nomination.destination,
              expectedLoadingDate: nomination.expectedLoadingDate,
              ambQuantity: num(nomination.ambQuantity),
              vessels: vessels.map((vessel) => ({
                id: vessel.id,
                stockId: vessel.stockId,
                ambQuantity: num(vessel.ambQuantity),
                cargo: {
                  id: vessel.stock.cargo.id,
                  blRef: vessel.stock.cargo.blRef,
                  vesselName: vessel.stock.cargo.vesselName,
                  tansisRef: vessel.stock.cargo.tansisRef,
                  outurnRef: vessel.stock.cargo.outurnRef,
                },
                order: {
                  ...vessel.stock.cargo.order,
                  quantity: num(vessel.stock.cargo.order.quantity),
                },
              })),
            },
            t1Validation: {
              id: t1Validation.id,
              exportingCountry: t1Validation.exportingCountry,
              quantityAt20C: num(t1Validation.quantityAt20C),
            },
            // Headline assessment: T1-validated vs received, both at 20C.
            tolerance: atStandard,
            // Secondary view: dispatched vs received in ambient terms.
            ambient: this.assessTolerance(
              num(nomination.ambQuantity),
              num(stock.ambQuantity),
              appliedRate,
              "nominated",
            ),
            recorded: {
              toleranceRate:
                stock.toleranceRate === null ? null : num(stock.toleranceRate),
              gainQty: stock.gainQty === null ? null : num(stock.gainQty),
              lossQty: stock.lossQty === null ? null : num(stock.lossQty),
              matchesComputed:
                round(num(stock.gainQty) - num(stock.lossQty)) ===
                atStandard.variance,
            },
          };
        },
      );
      return {
        ...item,
        allowedRate: itemRate,
        toleranceRates: toleranceRates.map((rate) => ({
          ...rate,
          maxRate: num(rate.maxRate),
        })),
        summary: this.summariseTolerance(
          receipts.map((receipt) => receipt.tolerance),
          itemRate,
        ),
        receipts,
      };
    });

    const overall = allReceipts.map((receipt) => {
      const expected = this.expectedQuantity(
        receipt.t1Validation.quantityAt20C,
        receipt.t1Validation.nomination.ambQuantity,
      );
      return this.assessTolerance(
        expected.quantity,
        num(receipt.quantityAt20C),
        receipt.toleranceRate === null
          ? (rateByItem.get(receipt.itemId) ?? null)
          : num(receipt.toleranceRate),
        expected.basis,
      );
    });

    return {
      ...paginatedData(items, total, query),
      summary: {
        itemCount: total,
        ...this.summariseTolerance(overall, null),
        recordedGainQty: round(
          allReceipts.reduce((sum, row) => sum + num(row.gainQty), 0),
        ),
        recordedLossQty: round(
          allReceipts.reduce((sum, row) => sum + num(row.lossQty), 0),
        ),
      },
    };
  }

  /** Rolls a set of graded receipts into the numbers a reader actually wants. */
  private summariseTolerance(
    assessments: ReturnType<ReportRepository["assessTolerance"]>[],
    allowedRate: number | null,
  ) {
    const total = (pick: (row: (typeof assessments)[number]) => number) =>
      round(assessments.reduce((sum, row) => sum + pick(row), 0));
    const count = (status: ToleranceStatus) =>
      assessments.filter((row) => row.status === status).length;

    const expectedQuantity = total((row) => row.expectedQuantity);
    const actualQuantity = total((row) => row.actualQuantity);
    const netVariance = round(actualQuantity - expectedQuantity);
    const assessed = assessments.filter((row) => row.status !== "notAssessed");
    const breached = assessments.filter(
      (row) => row.status === "exceededGain" || row.status === "exceededLoss",
    );
    const worst = [...assessments]
      .filter((row) => row.variancePct !== null)
      .sort((a, b) => Math.abs(b.variancePct!) - Math.abs(a.variancePct!))[0];

    return {
      receiptCount: assessments.length,
      expectedQuantity,
      actualQuantity,
      netVariance,
      netVariancePct:
        expectedQuantity > 0
          ? round((netVariance / expectedQuantity) * 100)
          : null,
      netOutcome: (netVariance > 0
        ? "gain"
        : netVariance < 0
          ? "loss"
          : "balanced") as ToleranceOutcome,
      totalGain: total((row) => (row.variance > 0 ? row.variance : 0)),
      totalLoss: total((row) => (row.variance < 0 ? -row.variance : 0)),
      allowedRate,
      withinToleranceCount: count("withinTolerance"),
      exceededGainCount: count("exceededGain"),
      exceededLossCount: count("exceededLoss"),
      notAssessedCount: count("notAssessed"),
      breachedQuantity: total((row) => row.exceededBy),
      complianceRate: assessed.length
        ? round(((assessed.length - breached.length) / assessed.length) * 100)
        : null,
      worstVariancePct: worst?.variancePct ?? null,
      // How many receipts fell back to the nominated quantity because their
      // T1 validation carries no quantity — high numbers mean the headline
      // figures are softer than they look.
      measuredAgainst: {
        t1Validated: assessments.filter((row) => row.basis === "t1Validated")
          .length,
        nominated: assessments.filter((row) => row.basis === "nominated")
          .length,
      },
    };
  }

  async supplyChainOrdersByOrderPlan(query: ReportOrderQuery) {
    const orderWhere = this.orderWhere(query);
    const where: Prisma.OrderPlanWhereInput = { orders: { some: orderWhere } };
    const [rows, total] = await this.db.$transaction([
      this.db.orderPlan.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ startDate: "desc" }, { id: "desc" }],
        select: {
          id: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          orders: { where: orderWhere, select: { quantity: true } },
        },
      }),
      this.db.orderPlan.count({ where }),
    ]);
    return paginatedData(
      rows.map(({ orders, ...plan }) => ({
        ...plan,
        totalOrders: orders.length,
        orderedQuantity: orders
          .reduce((sum, row) => sum.plus(row.quantity), zero())
          .toNumber(),
      })),
      total,
      query,
    );
  }

  private stockWhere(
    query: CentralStockReportQuery,
  ): Prisma.CentralStockWhereInput {
    return {
      ...(query.centralStockId && { id: query.centralStockId }),
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.depotId && { deportId: query.depotId }),
      ...(query.status && { status: query.status }),
      ...(query.clearanceStatus && {
        stockClearances: { some: { status: query.clearanceStatus } },
      }),
      createdAt: { gte: query.startDate, lte: query.endDate },
    };
  }

  async centralStockReport(query: CentralStockReportQuery) {
    const where = this.stockWhere(query);
    return this.db.$transaction(
      async (tx) => {
        const [rows, total, stocks, movements, clearances] = await Promise.all([
          tx.centralStock.findMany({
            where,
            ...paginationArgs(query),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              ambQuantity: true,
              quantityAt20C: true,
              supportingDocUrl: true,
              status: true,
              toleranceRate: true,
              lossQty: true,
              gainQty: true,
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
              deport: {
                select: {
                  id: true,
                  name: true,
                  location: true,
                  type: true,
                  status: true,
                },
              },
              t1Validation: {
                select: {
                  id: true,
                  exportingCountry: true,
                  supportingDocUrl: true,
                  nomination: {
                    select: {
                      id: true,
                      destination: true,
                      expectedLoadingDate: true,
                      ambQuantity: true,
                    },
                  },
                },
              },
              // What it cost to land each receipt.
              chainStockFees: reportFeeSelect,
              _count: {
                select: {
                  transactions: true,
                  stockClearances: true,
                  centralStockOrders: true,
                },
              },
            },
          }),
          tx.centralStock.count({ where }),
          tx.centralStock.aggregate({
            where,
            _sum: {
              ambQuantity: true,
              quantityAt20C: true,
              gainQty: true,
              lossQty: true,
            },
          }),
          tx.stockTransaction.groupBy({
            by: ["type"],
            where: { centralStock: where },
            orderBy: { type: "asc" },
            _count: true,
            _sum: { quantity: true },
          }),
          tx.stockClearance.groupBy({
            by: ["status"],
            where: { centralStock: where },
            orderBy: { status: "asc" },
            _count: true,
            _sum: { quantity: true, fees: true, amount: true },
          }),
        ]);
        const incoming = movements
          .filter(
            (row) =>
              row.type === "received" || row.type === "reconcilliationIn",
          )
          .reduce((sum, row) => sum.plus(row._sum.quantity ?? 0), zero());
        const outgoing = movements
          .filter(
            (row) =>
              row.type === "saleOut" || row.type === "reconcilliationOut",
          )
          .reduce((sum, row) => sum.plus(row._sum.quantity ?? 0), zero());
        const landed = rows.map(({ chainStockFees, ...row }) => ({
          row,
          fees: presentFees(chainStockFees),
        }));
        return {
          ...paginatedData(
            landed.map(({ row, fees }) => ({
              ...row,
              ambQuantity: num(row.ambQuantity),
              quantityAt20C: num(row.quantityAt20C),
              toleranceRate:
                row.toleranceRate === null ? null : num(row.toleranceRate),
              lossQty: row.lossQty === null ? null : num(row.lossQty),
              gainQty: row.gainQty === null ? null : num(row.gainQty),
              // Each charge, with the totals by currency. Empty when none
              // were charged, so every row reads the same way.
              ...fees,
            })),
            total,
            query,
          ),
          summary: {
            stockCount: total,
            totalAmbientQuantity: num(stocks._sum.ambQuantity),
            totalQuantityAt20C: num(stocks._sum.quantityAt20C),
            totalGain: num(stocks._sum.gainQty),
            totalLoss: num(stocks._sum.lossQty),
            currentTransactionBalance: incoming.minus(outgoing).toNumber(),
            transactionsByType: Object.fromEntries(
              movements.map((row) => [
                row.type,
                { count: row._count, quantity: num(row._sum.quantity) },
              ]),
            ),
            clearancesByStatus: Object.fromEntries(
              clearances.map((row) => [
                row.status,
                {
                  count: row._count,
                  quantity: num(row._sum.quantity),
                  fees: num(row._sum.fees),
                  amount: num(row._sum.amount),
                },
              ]),
            ),
            /**
             * What landing the receipts on this page cost, grouped by
             * currency, and how many charges that was. This covers the page
             * rather than the whole filter, because a charge is read off the
             * receipt it sits on.
             */
            landingFeeTotals: sumFeeTotals(landed.map(({ fees }) => fees.feeTotals)),
            landingFeeCount: landed.reduce((count, { fees }) => count + fees.feeCount, 0),
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async centralStockTransactions(query: CentralStockTransactionReportQuery) {
    const where: Prisma.StockTransactionWhereInput = {
      ...(query.centralStockId && { centralStockId: query.centralStockId }),
      ...(query.type && { type: query.type }),
      ...(query.createdBy && { createdBy: query.createdBy }),
      createdAt: { gte: query.startDate, lte: query.endDate },
      ...((query.itemId || query.depotId) && {
        centralStock: {
          ...(query.itemId && { itemId: query.itemId }),
          ...(query.depotId && { deportId: query.depotId }),
        },
      }),
    };
    return this.db.$transaction(
      async (tx) => {
        const [rows, total, totals] = await Promise.all([
          tx.stockTransaction.findMany({
            where,
            ...paginationArgs(query),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              quantity: true,
              type: true,
              note: true,
              supportingDocUrl: true,
              createdAt: true,
              updatedAt: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              centralStock: {
                select: {
                  id: true,
                  status: true,
                  item: { select: { id: true, name: true } },
                  deport: { select: { id: true, name: true, location: true } },
                  // What landing the receipt this movement belongs to cost.
                  chainStockFees: reportFeeSelect,
                },
              },
            },
          }),
          tx.stockTransaction.count({ where }),
          tx.stockTransaction.groupBy({
            by: ["type"],
            where,
            orderBy: { type: "asc" },
            _count: true,
            _sum: { quantity: true },
          }),
        ]);
        return {
          ...paginatedData(
            rows.map(({ user, centralStock, ...row }) => ({
              ...row,
              quantity: num(row.quantity),
              createdBy: user,
              // The receipt, with what it cost to land — the same figures the
              // central stock report shows, so the two cannot disagree.
              centralStock: centralStock && (({ chainStockFees, ...receipt }) => ({
                ...receipt,
                ...presentFees(chainStockFees),
              }))(centralStock),
            })),
            total,
            query,
          ),
          summary: {
            transactionCount: total,
            byType: Object.fromEntries(
              totals.map((row) => [
                row.type,
                { count: row._count, quantity: num(row._sum.quantity) },
              ]),
            ),
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  /**
   * Inventory per item for a period: what was on hand when it opened, what came
   * in, what went out, and what was left. Movements are summed in the database
   * by stock and type, then folded up to the item each stock belongs to.
   *
   *   opening  = in - out, for every movement before `startDate`
   *   stockIn  = received + reconcilliationIn within the period
   *   consumed = saleOut + reconcilliationOut within the period
   *   closing  = opening + stockIn - consumed
   *   total    = opening + stockIn, i.e. everything available in the period
   */
  async centralStockInventory(query: CentralStockInventoryQuery) {
    const stockWhere: Prisma.CentralStockWhereInput = {
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.depotId && { deportId: query.depotId }),
    };

    return this.db.$transaction(
      async (tx) => {
        const [before, during] = await Promise.all([
          tx.stockTransaction.groupBy({
            by: ["centralStockId", "type"],
            where: { centralStock: stockWhere, createdAt: { lt: query.startDate } },
            orderBy: [{ centralStockId: "asc" }, { type: "asc" }],
            _sum: { quantity: true },
          }),
          tx.stockTransaction.groupBy({
            by: ["centralStockId", "type"],
            where: {
              centralStock: stockWhere,
              createdAt: { gte: query.startDate, lte: query.endDate },
            },
            orderBy: [{ centralStockId: "asc" }, { type: "asc" }],
            _sum: { quantity: true },
          }),
        ]);

        const stockIds = [
          ...new Set([...before, ...during].map((row) => row.centralStockId)),
        ];
        const stocks = await tx.centralStock.findMany({
          where: { id: { in: stockIds } },
          select: {
            id: true,
            item: {
              select: {
                id: true,
                name: true,
                baseUnit: { select: { id: true, name: true, code: true } },
              },
            },
            // What landing each receipt cost, to fold up to its item.
            chainStockFees: reportFeeSelect,
          },
        });
        const itemByStock = new Map(stocks.map((stock) => [stock.id, stock.item]));

        /**
         * What landing the period's receipts cost, per item and grouped by
         * currency. Counted once per receipt, however many movements it has —
         * a fee is charged on the receipt, not on each movement of it.
         */
        const landingByItem = new Map<string, { feeTotals: Record<string, number>; feeCount: number }>();
        for (const stock of stocks) {
          const fees = presentFees(stock.chainStockFees);
          const landed = landingByItem.get(stock.item.id) ?? { feeTotals: {}, feeCount: 0 };
          landingByItem.set(stock.item.id, {
            feeTotals: sumFeeTotals([landed.feeTotals, fees.feeTotals]),
            feeCount: landed.feeCount + fees.feeCount,
          });
        }

        type Totals = {
          item: (typeof stocks)[number]["item"];
          opening: Prisma.Decimal;
          received: Prisma.Decimal;
          reconciledIn: Prisma.Decimal;
          sold: Prisma.Decimal;
          reconciledOut: Prisma.Decimal;
        };
        const byItem = new Map<string, Totals>();
        const totalsFor = (stockId: string) => {
          const item = itemByStock.get(stockId)!;
          let totals = byItem.get(item.id);
          if (!totals) {
            totals = {
              item,
              opening: zero(),
              received: zero(),
              reconciledIn: zero(),
              sold: zero(),
              reconciledOut: zero(),
            };
            byItem.set(item.id, totals);
          }
          return totals;
        };

        for (const row of before) {
          const totals = totalsFor(row.centralStockId);
          const quantity = row._sum.quantity ?? zero();
          const incoming = row.type === "received" || row.type === "reconcilliationIn";
          totals.opening = incoming
            ? totals.opening.plus(quantity)
            : totals.opening.minus(quantity);
        }
        for (const row of during) {
          const totals = totalsFor(row.centralStockId);
          const quantity = row._sum.quantity ?? zero();
          if (row.type === "received") totals.received = totals.received.plus(quantity);
          if (row.type === "reconcilliationIn") totals.reconciledIn = totals.reconciledIn.plus(quantity);
          if (row.type === "saleOut") totals.sold = totals.sold.plus(quantity);
          if (row.type === "reconcilliationOut") totals.reconciledOut = totals.reconciledOut.plus(quantity);
        }

        const items = [...byItem.values()]
          .sort((a, b) => a.item.name.localeCompare(b.item.name))
          .map((totals) => {
            const stockIn = totals.received.plus(totals.reconciledIn);
            const consumed = totals.sold.plus(totals.reconciledOut);
            const totalStock = totals.opening.plus(stockIn);
            return {
              item: totals.item,
              opening: totals.opening.toNumber(),
              stockIn: stockIn.toNumber(),
              consumed: consumed.toNumber(),
              closing: totalStock.minus(consumed).toNumber(),
              totalStock: totalStock.toNumber(),
              // What each column is made of, for a drill-down or tooltip.
              breakdown: {
                received: totals.received.toNumber(),
                reconciledIn: totals.reconciledIn.toNumber(),
                sold: totals.sold.toNumber(),
                reconciledOut: totals.reconciledOut.toNumber(),
              },
              // What landing this item's receipts cost, by currency. `{}` when
              // no fee was charged against any of them.
              landingFeeTotals: landingByItem.get(totals.item.id)?.feeTotals ?? {},
              landingFeeCount: landingByItem.get(totals.item.id)?.feeCount ?? 0,
            };
          });

        const sum = (pick: (row: (typeof items)[number]) => number) =>
          items.reduce((total, row) => total.plus(pick(row)), zero()).toNumber();

        return {
          period: { startDate: query.startDate, endDate: query.endDate },
          items,
          totals: {
            itemCount: items.length,
            opening: sum((row) => row.opening),
            stockIn: sum((row) => row.stockIn),
            consumed: sum((row) => row.consumed),
            closing: sum((row) => row.closing),
            totalStock: sum((row) => row.totalStock),
            // Never added across currencies: that would be a wrong number
            // rather than a rounded one.
            landingFeeTotals: sumFeeTotals(items.map((row) => row.landingFeeTotals)),
            landingFeeCount: items.reduce((count, row) => count + row.landingFeeCount, 0),
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
