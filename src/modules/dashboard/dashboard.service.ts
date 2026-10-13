import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { forbidden } from "../../utils/errors.js";
import { BUSINESS_UTC_OFFSET, DashboardRepository, type DailySales } from "./dashboard.repository.js";
import type { DashboardQuery } from "./dashboard.schema.js";

const OFFSET_MS = 2 * 60 * 60_000;

/** `YYYY-MM-DD` moved by a number of days. */
export function addDays(day: string, by: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

/** The business day it is now, in Rwanda. */
export function businessToday(now = new Date()) {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Percentage change, one decimal; `null` when there is nothing to compare with. */
const change = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

interface Totals { amount: number; quantity: number; count: number }
const empty = (): Totals => ({ amount: 0, quantity: 0, count: 0 });
function add(totals: Totals, row: DailySales) {
  totals.amount += row.amount;
  totals.quantity += row.quantity;
  totals.count += row.count;
}
const sum = (rows: DailySales[]) => rows.reduce((totals, row) => (add(totals, row), totals), empty());
const tidy = ({ amount, quantity, count }: Totals) => ({ amount: round2(amount), quantity: round2(quantity), count });

/**
 * The multi-site dashboard: sales from the start of the period up to
 * yesterday — today is left out, as it is still being sold — with yesterday
 * and the month so far set against the periods before them.
 */
export class DashboardService {
  constructor(private repo: DashboardRepository) {}

  async summary(query: DashboardQuery, actor: AuthUser, now = new Date()) {
    const siteId = this.scope(actor);
    const today = businessToday(now);
    const yesterday = addDays(today, -1);
    const dayBefore = addDays(yesterday, -1);
    const startDate = query.startDate ?? `${yesterday.slice(0, 4)}-01-01`;
    const monthStart = `${yesterday.slice(0, 7)}-01`;
    // The same days of last month: 1 Sep – 12 Sep against 1 Oct – 12 Oct.
    const previousMonthStart = addDays(monthStart, -1).slice(0, 8) + "01";
    const previousMonthEnd = (() => {
      const sameDay = `${previousMonthStart.slice(0, 8)}${yesterday.slice(8)}`;
      const lastDay = addDays(monthStart, -1);
      return sameDay > lastDay || Number.isNaN(Date.parse(sameDay)) ? lastDay : sameDay;
    })();

    const from = [startDate, previousMonthStart, dayBefore].sort()[0];
    const rows = startDate <= yesterday ? await this.repo.dailySales(from, yesterday, siteId) : [];
    const between = (start: string, end: string) => rows.filter((row) => row.day >= start && row.day <= end);
    const inPeriod = between(startDate, yesterday);

    const period = sum(inPeriod);
    const sellingDays = new Set(inPeriod.map((row) => row.day)).size;
    const yesterdays = sum(between(yesterday, yesterday));
    const daysBefore = sum(between(dayBefore, dayBefore));
    const month = sum(between(monthStart, yesterday));
    const previousMonth = sum(between(previousMonthStart, previousMonthEnd));

    // Products and sites over the period, with yesterday and the month alongside.
    const byKey = (key: "itemId" | "siteId") => {
      const groups = new Map<string, { period: Totals; yesterday: Totals; month: Totals; lastDay: string | null }>();
      for (const row of inPeriod) {
        const group = groups.get(row[key]) ?? { period: empty(), yesterday: empty(), month: empty(), lastDay: null };
        add(group.period, row);
        if (row.day === yesterday) add(group.yesterday, row);
        if (row.day >= monthStart) add(group.month, row);
        if (!group.lastDay || row.day > group.lastDay) group.lastDay = row.day;
        groups.set(row[key], group);
      }
      return groups;
    };
    const itemGroups = byKey("itemId");
    const siteGroups = byKey("siteId");
    const [items, activeSites] = await Promise.all([this.repo.items([...itemGroups.keys()]), this.repo.sites(siteId)]);
    const share = (amount: number) => (period.amount === 0 ? 0 : Math.round((amount / period.amount) * 1000) / 10);

    const monthly = new Map<string, Totals>();
    for (const row of inPeriod) {
      const totals = monthly.get(row.day.slice(0, 7)) ?? empty();
      add(totals, row);
      monthly.set(row.day.slice(0, 7), totals);
    }

    return {
      period: {
        startDate, endDate: yesterday, yesterday, today,
        generatedAt: now.toISOString(), excludesToday: true, utcOffset: BUSINESS_UTC_OFFSET,
        siteId: siteId ?? null,
      },
      summary: {
        ...tidy(period),
        sellingDays,
        averageDailyAmount: sellingDays === 0 ? 0 : round2(period.amount / sellingDays),
        averagePrice: period.quantity === 0 ? 0 : round2(period.amount / period.quantity),
        activeSites: activeSites.length,
        yesterday: { ...tidy(yesterdays), previousDayAmount: round2(daysBefore.amount), change: change(yesterdays.amount, daysBefore.amount) },
        month: {
          month: monthStart.slice(0, 7), ...tidy(month),
          previousPeriod: { startDate: previousMonthStart, endDate: previousMonthEnd, amount: round2(previousMonth.amount) },
          change: change(month.amount, previousMonth.amount),
        },
      },
      items: items
        .map((item) => {
          const group = itemGroups.get(item.id)!;
          return {
            item: { id: item.id, name: item.name, unit: item.baseUnit?.code ?? null },
            ...tidy(group.period),
            share: share(group.period.amount),
            averagePrice: group.period.quantity === 0 ? 0 : round2(group.period.amount / group.period.quantity),
            yesterdayAmount: round2(group.yesterday.amount),
            monthAmount: round2(group.month.amount),
          };
        })
        .sort((a, b) => b.amount - a.amount),
      // Every active site, even one with no sales yet, so a quiet site shows up.
      sites: activeSites
        .map((site) => {
          const group = siteGroups.get(site.id);
          return {
            site,
            ...tidy(group?.period ?? empty()),
            share: share(group?.period.amount ?? 0),
            yesterdayAmount: round2(group?.yesterday.amount ?? 0),
            monthAmount: round2(group?.month.amount ?? 0),
            lastSaleDay: group?.lastDay ?? null,
          };
        })
        .sort((a, b) => b.amount - a.amount),
      monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([monthKey, totals]) => ({ month: monthKey, ...tidy(totals) })),
    };
  }

  /** Everything for a super administrator; their own site for site staff. */
  private scope(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (!isSiteBound(actor) || !actor.siteId) {
      throw forbidden("The dashboard is for super administrators and site staff assigned to a site");
    }
    return actor.siteId;
  }
}
