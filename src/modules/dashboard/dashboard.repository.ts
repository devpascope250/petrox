import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";

/** One day's sales of one product at one site, both sources added together. */
export interface DailySales {
  siteId: string;
  itemId: string;
  /** `YYYY-MM-DD`, a business day. */
  day: string;
  quantity: number;
  amount: number;
  count: number;
}

/**
 * Rwanda keeps UTC+2 all year. POS sales are stored in UTC and counted on the
 * business day they were confirmed; fuel sales already carry their working day.
 */
export const BUSINESS_UTC_OFFSET = "+02:00";

export class DashboardRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Sales from both sources between two business days (inclusive), summed by
   * site, product and day: fuel sales recorded on the web (`FuelSale`, whose
   * product is the tank it was drawn from) and confirmed POS sales
   * (`GeneralTransaction`).
   */
  async dailySales(startDay: string, endDay: string, siteId?: string): Promise<DailySales[]> {
    const fuelSite = siteId ? Prisma.sql`AND s.siteId = ${siteId}` : Prisma.empty;
    const posSite = siteId ? Prisma.sql`AND g.siteId = ${siteId}` : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{
      siteId: string; itemId: string; day: Date | string; quantity: Prisma.Decimal; amount: Prisma.Decimal; count: bigint;
    }>>`
      SELECT siteId, itemId, day, SUM(quantity) AS quantity, SUM(amount) AS amount, COUNT(*) AS count
      FROM (
        SELECT s.siteId AS siteId, c.itemId AS itemId, s.dateOn AS day, s.quantity AS quantity, s.amount AS amount
        FROM FuelSale s
        -- A POS sale is also written as a fuel sale; it is counted below, from the POS side.
        JOIN CuveTransaction ct ON ct.saleId = s.id AND ct.generalTransactionId IS NULL
        JOIN TblCuve c ON c.id = ct.cuveId
        WHERE s.dateOn BETWEEN ${startDay} AND ${endDay} ${fuelSite}
        UNION ALL
        SELECT g.siteId, g.itemId, DATE(CONVERT_TZ(g.confirmedAt, '+00:00', ${BUSINESS_UTC_OFFSET})), g.quantity, g.amount
        FROM GeneralTransaction g
        WHERE g.status = 'confirmed'
          AND g.confirmedAt >= CONVERT_TZ(${startDay}, ${BUSINESS_UTC_OFFSET}, '+00:00')
          AND g.confirmedAt < CONVERT_TZ(DATE_ADD(${endDay}, INTERVAL 1 DAY), ${BUSINESS_UTC_OFFSET}, '+00:00')
          ${posSite}
      ) sales
      GROUP BY siteId, itemId, day
    `;
    return rows.map((row) => ({
      siteId: row.siteId,
      itemId: row.itemId,
      day: typeof row.day === "string" ? row.day.slice(0, 10) : row.day.toISOString().slice(0, 10),
      quantity: Number(row.quantity),
      amount: Number(row.amount),
      count: Number(row.count),
    }));
  }

  /** Active sites — or just the one a site's staff work at. */
  sites(siteId?: string) {
    return this.db.tblSite.findMany({
      where: { status: "active", ...(siteId ? { id: siteId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * The supply chain over a period, in one round of aggregates: what was
   * ordered, what arrived, what it cost in loss or gain, and what is still
   * waiting to be cleared.
   *
   * Each figure is counted on the date that step happened — an order on its
   * order date, a cargo on the date it was offloaded, a receipt on the day it
   * was written — rather than all of them on `createdAt`, so a cargo entered
   * late lands in the period it belongs to.
   */
  async supplyChain(start: Date, endExclusive: Date) {
    const period = { gte: start, lt: endExclusive };
    const [orders, cargo, receipts, trips, awaiting, held, network] = await Promise.all([
      this.db.order.aggregate({ where: { orderDate: period }, _count: true, _sum: { quantity: true } }),
      // A cancelled cargo never arrived, so it is not volume offloaded.
      this.db.cargo.aggregate({
        where: { receivedDate: period, status: { not: "cancelled" } },
        _count: true,
        _sum: { quantityInLitre: true, quantityInKg: true },
      }),
      this.db.centralStock.aggregate({
        where: { createdAt: period },
        _count: true,
        _sum: { quantityAt20C: true, ambQuantity: true, lossQty: true, gainQty: true },
      }),
      this.db.nomination.count({ where: { createdAt: period } }),
      // Not period-bound: a clearance waiting for approval is waiting now.
      this.db.clearanceRequest.aggregate({
        where: { clearanceStatus: "awaiting", paymentDocUrl: null },
        _count: true,
        _sum: { amount: true },
      }),
      this.db.stockClearance.aggregate({ where: { status: "uncleared" }, _sum: { quantity: true } }),
      Promise.all([
        this.db.supplier.count({ where: { status: "active" } }),
        this.db.transporter.count({ where: { status: "active" } }),
        this.db.driver.count({ where: { status: "active" } }),
        this.db.vehicle.count({ where: { status: "active" } }),
        // `Deport.status` is free text rather than the usual enum, so every
        // depot is counted rather than guessing at which words mean active.
        this.db.deport.count(),
      ]),
    ]);
    const [suppliers, transporters, drivers, vehicles, deports] = network;
    return { orders, cargo, receipts, trips, awaiting, held, network: { suppliers, transporters, drivers, vehicles, deports } };
  }

  items(ids: string[]) {
    return this.db.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, baseUnit: { select: { code: true } } },
    });
  }
}
