import { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/index.js";
import {
  DepotStockMovementReportQuery,
  invoiceStatuses,
  ProcurementOrderReportQuery,
  procurementOrderStatuses,
} from "./operations-report.schema.js";

const num = (value: Prisma.Decimal | null | undefined) => Number(value ?? 0);
const round = (value: number) => Math.round(value * 100) / 100;
const distinct = <T>(values: T[]) => Array.from(new Set(values));

type ProcurementOrderStatus = (typeof procurementOrderStatuses)[number];
type InvoiceStatus = (typeof invoiceStatuses)[number];
type Invoice = { id: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; amount?: Prisma.Decimal; currencyCode: string };

/**
 * Quantity-weighted unit price across invoices. Only meaningful when every
 * invoice shares one currency; otherwise the price is null and the currency
 * is reported as "mixed".
 */
function pricing(invoices: Invoice[]) {
  const currencies = distinct(invoices.map((invoice) => invoice.currencyCode));
  const quantity = invoices.reduce((sum, invoice) => sum + num(invoice.quantity), 0);
  const currency = currencies.length > 1 ? "mixed" : currencies[0] ?? null;
  const unitPrice = currencies.length === 1 && quantity > 0
    ? round(invoices.reduce((sum, invoice) => sum + num(invoice.unitPrice) * num(invoice.quantity), 0) / quantity)
    : null;
  return { currency, unitPrice, quantity };
}

type Movement = { received: number; issuedToPss: number; issuedToB2b: number; saleOut: number; lossGain: number };
const emptyMovement = (): Movement => ({ received: 0, issuedToPss: 0, issuedToB2b: 0, saleOut: 0, lossGain: 0 });
const signed = (type: string, quantity: number) =>
  type === "received" || type === "reconcilliationIn" ? quantity : -quantity;

export class OperationsReportRepository {
  constructor(private db: PrismaClient) {}

  /**
   * International / local procurement and import orders: one row per order,
   * with loading, vessel and pricing details rolled up from its cargos and
   * their supplier invoices. Cancelled cargos are ignored.
   */
  async procurementOrders(query: ProcurementOrderReportQuery) {
    const where: Prisma.OrderWhereInput = {
      orderDate: { gte: query.startDate, lte: query.endDate },
      ...(query.supplierId && { supplierId: query.supplierId }),
      ...(query.orderPlanId && { orderPlanId: query.orderPlanId }),
      ...(query.itemId && { itemId: query.itemId }),
      ...(query.orderCode && { orderCode: { contains: query.orderCode } }),
      ...(query.deportId && { cargos: { some: { deportId: query.deportId } } }),
    };
    return this.db.$transaction(
      async (tx) => {
        const [orders, total, ordered, received, invoiced] = await Promise.all([
          tx.order.findMany({
            where,
            ...paginationArgs(query),
            orderBy: [{ orderDate: "desc" }, { id: "desc" }],
            select: {
              id: true,
              orderCode: true,
              orderDate: true,
              quantity: true,
              supplier: { select: { id: true, name: true } },
              item: { select: { id: true, name: true } },
              plan: { select: { id: true, name: true } },
              cargos: {
                where: { status: { not: "cancelled" } },
                orderBy: { receivedDate: "asc" },
                select: {
                  id: true,
                  vesselName: true,
                  blRef: true,
                  tansisRef: true,
                  outurnRef: true,
                  receivedDate: true,
                  quantityInKg: true,
                  quantityInLitre: true,
                  status: true,
                  deport: { select: { id: true, name: true, location: true, type: true } },
                  cargoInvoices: {
                    select: { id: true, invoiceReference: true, quantity: true, unitPrice: true, amount: true, currencyCode: true },
                  },
                },
              },
            },
          }),
          tx.order.count({ where }),
          tx.order.aggregate({ where, _sum: { quantity: true } }),
          tx.cargo.aggregate({ where: { order: where, status: "approved" }, _sum: { quantityInLitre: true } }),
          tx.cargoInvoice.groupBy({
            by: ["currencyCode"],
            where: { cargo: { order: where, status: { not: "cancelled" } } },
            orderBy: { currencyCode: "asc" },
            _count: true,
            _sum: { quantity: true, amount: true },
          }),
        ]);

        const items = orders.map(({ cargos, plan, ...order }) => {
          const volumeOrdered = num(order.quantity);
          const receivedVolume = cargos
            .filter((cargo) => cargo.status === "approved")
            .reduce((sum, cargo) => sum + num(cargo.quantityInLitre), 0);
          const orderStatus: ProcurementOrderStatus = cargos.length === 0
            ? "ordered"
            : volumeOrdered > 0 && receivedVolume >= volumeOrdered
              ? "received"
              : receivedVolume > 0 ? "partiallyReceived" : "inTransit";

          const invoices = cargos.flatMap((cargo) => cargo.cargoInvoices);
          const { currency, unitPrice, quantity: invoicedVolume } = pricing(invoices);
          const invoiceStatus: InvoiceStatus = invoices.length === 0
            ? "notInvoiced"
            : invoicedVolume >= volumeOrdered ? "invoiced" : "partiallyInvoiced";

          return {
            id: order.id,
            orderId: order.orderCode,
            orderDate: order.orderDate,
            supplier: order.supplier,
            product: order.item,
            orderPlan: plan,
            loadingLocation: distinct(cargos.map((cargo) => cargo.deport.name)).join(", ") || null,
            vesselBlRef: cargos.map((cargo) => `${cargo.vesselName} / ${cargo.blRef}`).join(", ") || null,
            volumeOrdered,
            receivedVolume: round(receivedVolume),
            unitPrice,
            currency,
            totalValue: unitPrice === null ? null : round(volumeOrdered * unitPrice),
            invoicedAmount: currency && currency !== "mixed"
              ? round(invoices.reduce((sum, invoice) => sum + num(invoice.amount), 0))
              : null,
            expectedArrival: cargos[0]?.receivedDate ?? null,
            invoiceStatus,
            orderStatus,
            cargos: cargos.map(({ cargoInvoices, ...cargo }) => ({
              ...cargo,
              quantityInKg: num(cargo.quantityInKg),
              quantityInLitre: num(cargo.quantityInLitre),
              invoices: cargoInvoices.map((invoice) => ({
                ...invoice,
                quantity: num(invoice.quantity),
                unitPrice: num(invoice.unitPrice),
                amount: num(invoice.amount),
              })),
            })),
          };
        });

        return {
          ...paginatedData(items, total, query),
          summary: {
            totalOrders: total,
            totalVolumeOrdered: num(ordered._sum.quantity),
            totalVolumeReceived: num(received._sum.quantityInLitre),
            invoicedByCurrency: Object.fromEntries(
              invoiced.map((row) => [
                row.currencyCode,
                { invoices: row._count, quantity: num(row._sum.quantity), amount: num(row._sum.amount) },
              ]),
            ),
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  /** Splits the report window into day, month or single-period buckets. */
  private buckets(query: DepotStockMovementReportQuery) {
    const { startDate, endDate, interval } = query;
    if (interval === "period") {
      return [{ key: "period", start: startDate, end: endDate }];
    }
    const buckets: Array<{ key: string; start: Date; end: Date }> = [];
    const cursor = new Date(Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      interval === "day" ? startDate.getUTCDate() : 1,
    ));
    while (cursor <= endDate) {
      const next = new Date(cursor);
      if (interval === "day") next.setUTCDate(next.getUTCDate() + 1);
      else next.setUTCMonth(next.getUTCMonth() + 1);
      buckets.push({
        key: cursor.toISOString().slice(0, interval === "day" ? 10 : 7),
        start: cursor < startDate ? startDate : new Date(cursor),
        end: next.getTime() - 1 > endDate.getTime() ? endDate : new Date(next.getTime() - 1),
      });
      cursor.setTime(next.getTime());
    }
    return buckets;
  }

  private bucketKey(date: Date, query: DepotStockMovementReportQuery) {
    if (query.interval === "period") return "period";
    return date.toISOString().slice(0, query.interval === "day" ? 10 : 7);
  }

  /**
   * Public fuel depot stock movement: a running book ledger per depot and
   * product, built from central stock transactions. Issues are split by the
   * central stock orders behind them (internal → PSS, b2b → B2B); sale-outs
   * without a live order (manual sale-outs, or orders later rejected or
   * cancelled, which do not reverse their sale-out) land in `otherIssues` so
   * the book always balances. Loss/gain is the net of stock reconciliations.
   */
  async depotStockMovement(query: DepotStockMovementReportQuery) {
    const stockWhere: Prisma.CentralStockWhereInput = {
      ...(query.depotId && { deportId: query.depotId }),
      ...(query.itemId && { itemId: query.itemId }),
    };
    return this.db.$transaction(
      async (tx) => {
        const stocks = await tx.centralStock.findMany({
          where: stockWhere,
          select: {
            id: true,
            deport: { select: { id: true, name: true, location: true } },
            item: { select: { id: true, name: true } },
            t1Validation: {
              select: {
                nomination: {
                  select: {
                    nominationVessels: {
                      select: {
                        stock: {
                          select: {
                            cargo: {
                              select: {
                                cargoInvoices: { select: { id: true, quantity: true, unitPrice: true, currencyCode: true } },
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
        const ids = stocks.map((stock) => stock.id);
        const range = { gte: query.startDate, lte: query.endDate };
        const [before, transactions, orders] = await Promise.all([
          tx.stockTransaction.groupBy({
            by: ["centralStockId", "type"],
            where: { centralStockId: { in: ids }, createdAt: { lt: query.startDate } },
            orderBy: [{ centralStockId: "asc" }, { type: "asc" }],
            _sum: { quantity: true },
          }),
          tx.stockTransaction.findMany({
            where: { centralStockId: { in: ids }, createdAt: range },
            select: { centralStockId: true, type: true, quantity: true, createdAt: true },
          }),
          tx.centralStockOrder.findMany({
            where: { centralStockId: { in: ids }, createdAt: range, status: { notIn: ["rejected", "cancelled"] } },
            select: { centralStockId: true, orderType: true, quantity: true, createdAt: true },
          }),
        ]);

        const combos = new Map<string, {
          depot: (typeof stocks)[number]["deport"];
          product: (typeof stocks)[number]["item"];
          invoices: Map<string, Invoice>;
          opening: number;
          movements: Map<string, Movement>;
        }>();
        const comboOf = new Map<string, string>();
        for (const stock of stocks) {
          const key = `${stock.deport.id}:${stock.item.id}`;
          const combo = combos.get(key) ?? {
            depot: stock.deport, product: stock.item, invoices: new Map(), opening: 0, movements: new Map(),
          };
          // One nomination can load from several vessels, so the cost of a
          // receipt draws on every cargo behind it.
          for (const vessel of stock.t1Validation.nomination.nominationVessels) {
            for (const invoice of vessel.stock.cargo.cargoInvoices) {
              combo.invoices.set(invoice.id, invoice);
            }
          }
          combos.set(key, combo);
          comboOf.set(stock.id, key);
        }

        for (const row of before) {
          combos.get(comboOf.get(row.centralStockId)!)!.opening += signed(row.type, num(row._sum.quantity));
        }
        const movementAt = (centralStockId: string, date: Date) => {
          const combo = combos.get(comboOf.get(centralStockId)!)!;
          const key = this.bucketKey(date, query);
          const movement = combo.movements.get(key) ?? emptyMovement();
          combo.movements.set(key, movement);
          return movement;
        };
        for (const row of transactions) {
          const movement = movementAt(row.centralStockId, row.createdAt);
          const quantity = num(row.quantity);
          if (row.type === "received") movement.received += quantity;
          else if (row.type === "saleOut") movement.saleOut += quantity;
          else movement.lossGain += signed(row.type, quantity);
        }
        for (const row of orders) {
          const movement = movementAt(row.centralStockId, row.createdAt);
          if (row.orderType === "internal") movement.issuedToPss += num(row.quantity);
          else movement.issuedToB2b += num(row.quantity);
        }

        const buckets = this.buckets(query);
        const totals = { ...emptyMovement(), otherIssues: 0, openingStock: 0, closingBookStock: 0 };
        const stockValueByCurrency: Record<string, number> = {};
        const rows = [];
        for (const combo of combos.values()) {
          const { unitPrice: unitCost, currency } = pricing(Array.from(combo.invoices.values()));
          let balance = combo.opening;
          totals.openingStock += balance;
          for (const bucket of buckets) {
            const movement = combo.movements.get(bucket.key);
            if (!movement && round(balance) === 0) continue;
            const m = movement ?? emptyMovement();
            const otherIssues = m.saleOut - m.issuedToPss - m.issuedToB2b;
            const closing = balance + m.received - m.saleOut + m.lossGain;
            rows.push({
              date: bucket.key,
              periodStart: bucket.start,
              periodEnd: bucket.end,
              depot: combo.depot,
              product: combo.product,
              openingStock: round(balance),
              received: round(m.received),
              issuedToPss: round(m.issuedToPss),
              issuedToB2b: round(m.issuedToB2b),
              otherIssues: round(otherIssues),
              lossGain: round(m.lossGain),
              closingBookStock: round(closing),
              // No physical dip / count is captured for central depots yet.
              physicalStock: null,
              variance: null,
              unitCost,
              currency,
              stockValue: unitCost === null ? null : round(closing * unitCost),
            });
            totals.received += m.received;
            totals.issuedToPss += m.issuedToPss;
            totals.issuedToB2b += m.issuedToB2b;
            totals.otherIssues += otherIssues;
            totals.lossGain += m.lossGain;
            balance = closing;
          }
          totals.closingBookStock += balance;
          if (unitCost !== null && currency) {
            stockValueByCurrency[currency] = round((stockValueByCurrency[currency] ?? 0) + balance * unitCost);
          }
        }
        rows.sort((a, b) =>
          a.periodStart.getTime() - b.periodStart.getTime()
          || a.depot.name.localeCompare(b.depot.name)
          || a.product.name.localeCompare(b.product.name));

        const { skip, take } = paginationArgs(query);
        return {
          ...paginatedData(rows.slice(skip, skip + take), rows.length, query),
          summary: {
            interval: query.interval,
            startDate: query.startDate,
            endDate: query.endDate,
            openingStock: round(totals.openingStock),
            received: round(totals.received),
            issuedToPss: round(totals.issuedToPss),
            issuedToB2b: round(totals.issuedToB2b),
            otherIssues: round(totals.otherIssues),
            lossGain: round(totals.lossGain),
            closingBookStock: round(totals.closingBookStock),
            stockValueByCurrency,
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
