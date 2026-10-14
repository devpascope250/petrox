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

  items(ids: string[]) {
    return this.db.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, baseUnit: { select: { code: true } } },
    });
  }
}
