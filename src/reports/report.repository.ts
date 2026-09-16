import { Prisma, PrismaClient } from "../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../shared/pagination/index.js";
import {
  CentralStockReportQuery,
  CentralStockTransactionReportQuery,
  ReportOrderQuery,
} from "./report.schema.js";

const zero = () => new Prisma.Decimal(0);
const num = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);

export class ReportRepository {
  constructor(private db: PrismaClient) {}

  private orderWhere(query: ReportOrderQuery): Prisma.OrderWhereInput {
    return {
      orderDate: { gte: query.startDate, lte: query.endDate },
      ...(query.byOrderPlanId && { orderPlanId: query.byOrderPlanId }),
      ...(query.bySupplierId && { supplierId: query.bySupplierId }),
      ...(query.deportId && { cargos: { some: { deportId: query.deportId } } }),
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.orderCode && { orderCode: { contains: query.orderCode } }),
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
        _sum: { ambQuantity: true, quantityAt20C: true },
      }),
    ]);
    const cargoTotals = cargos as unknown as Array<{
      status: (typeof cargos)[number]["status"];
      _count: number;
      _sum: { ambQuantity: Prisma.Decimal | null; quantityAt20C: Prisma.Decimal | null };
    }>;
    return {
      totalOrders: orders._count._all,
      totalOrderedQuantity: num(orders._sum.quantity),
      totalCargos: cargoTotals.reduce((sum, row) => sum + row._count, 0),
      totalCargoAmbientQuantity: cargoTotals
        .reduce((sum, row) => sum.plus(row._sum.ambQuantity ?? 0), zero())
        .toNumber(),
      totalCargoQuantityAt20C: cargoTotals
        .reduce((sum, row) => sum.plus(row._sum.quantityAt20C ?? 0), zero())
        .toNumber(),
      cargosByStatus: Object.fromEntries(
        cargoTotals.map((row) => [
          row.status,
          {
            count: row._count,
            ambientQuantity: num(row._sum.ambQuantity),
            quantityAt20C: num(row._sum.quantityAt20C),
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
              ambQuantity: true,
              quantityAt20C: true,
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
          ambQuantity: num(cargo.ambQuantity),
          quantityAt20C: num(cargo.quantityAt20C),
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
                select: { quantityAt20C: true },
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
          .reduce((sum, row) => sum.plus(row.quantityAt20C), zero())
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
                select: { quantityAt20C: true },
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
          .reduce((sum, row) => sum.plus(row.quantityAt20C), zero())
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
            select: { ambQuantity: true, quantityAt20C: true, status: true },
          },
        },
      }),
      this.db.deport.count({ where }),
    ]);
    return paginatedData(
      rows.map(({ cargos, ...depot }) => ({
        ...depot,
        totalCargos: cargos.length,
        ambientQuantity: cargos
          .reduce((sum, row) => sum.plus(row.ambQuantity), zero())
          .toNumber(),
        quantityAt20C: cargos
          .reduce((sum, row) => sum.plus(row.quantityAt20C), zero())
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
                      quantityAt20C: true,
                    },
                  },
                },
              },
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
        return {
          ...paginatedData(
            rows.map((row) => ({
              ...row,
              ambQuantity: num(row.ambQuantity),
              quantityAt20C: num(row.quantityAt20C),
              toleranceRate:
                row.toleranceRate === null ? null : num(row.toleranceRate),
              lossQty: row.lossQty === null ? null : num(row.lossQty),
              gainQty: row.gainQty === null ? null : num(row.gainQty),
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
            rows.map(({ user, ...row }) => ({
              ...row,
              quantity: num(row.quantity),
              createdBy: user,
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
}
