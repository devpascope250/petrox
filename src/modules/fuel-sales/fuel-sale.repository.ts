import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/pagination.js";
import { fromDate, fromTime, toDate } from "../shifts/shift-scope.js";
import type { CreateFuelSale, FuelSaleFilters, FuelSaleListQuery, FuelSaleReportQuery } from "./fuel-sale.schema.js";

const person = { select: { id: true, firstName: true, lastName: true } } as const;
const itemSelect = { select: { id: true, name: true, baseUnit: true } } as const;

/** A sale as the screens read it: where it was sold, for how much, and who was paid. */
export const saleSelect = {
  id: true, siteId: true, dateOn: true, quantity: true, unitPrice: true, amount: true, note: true, createdAt: true,
  nozzle: { select: { id: true, name: true, nozzleCode: true } },
  pump: { select: { id: true, name: true } },
  shift: { select: { id: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } } },
  user: person,
  // The ledger row says which tank the litres came out of, and so which product.
  cuveTransaction: { select: { cuve: { select: { id: true, name: true, item: itemSelect } } } },
  payments: {
    select: { id: true, amount: true, reference: true, referenceDocUrl: true,
      account: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.FuelSaleSelect;

export function presentSale({ cuveTransaction, ...sale }: Prisma.FuelSaleGetPayload<{ select: typeof saleSelect }>) {
  return {
    ...sale,
    dateOn: fromDate(sale.dateOn),
    quantity: Number(sale.quantity),
    unitPrice: Number(sale.unitPrice),
    amount: Number(sale.amount),
    shift: sale.shift ? presentSiteShift(sale.shift) : null,
    cuve: cuveTransaction?.cuve ?? null,
    payments: sale.payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
  };
}

function presentSiteShift(siteShift: { id: string; shift: { name: string; startAt: Date; endAt: Date } }) {
  return { id: siteShift.id, name: siteShift.shift.name,
    startAt: fromTime(siteShift.shift.startAt), endAt: fromTime(siteShift.shift.endAt) };
}

const money = (value: number) => new Prisma.Decimal(value).toDecimalPlaces(2);
const zero = new Prisma.Decimal(0);

/** A groupBy row's totals as plain numbers, with the average price they imply. */
function figures(row: { _count: { _all: number }; _sum: { quantity: Prisma.Decimal | null; amount: Prisma.Decimal | null } }) {
  const quantity = row._sum.quantity ?? zero;
  const amount = row._sum.amount ?? zero;
  return {
    saleCount: row._count._all,
    quantity: Number(quantity),
    amount: Number(amount),
    averagePrice: quantity.isZero() ? 0 : Number(amount.div(quantity).toDecimalPlaces(2)),
  };
}

/** Today as a DATE value, by the server's clock. */
function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return toDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
}

/**
 * The working day a sale made right now belongs to. A shift that runs past
 * midnight (ends at or before it starts) still counts towards the day it
 * started, so a sale in its small hours goes to yesterday.
 */
function workingDay(shift?: { startAt: Date; endAt: Date } | null) {
  const day = today();
  if (!shift) return day;
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const overnight = fromTime(shift.endAt) <= fromTime(shift.startAt);
  if (overnight && clock < fromTime(shift.endAt)) day.setUTCDate(day.getUTCDate() - 1);
  return day;
}

export class FuelSaleRepository {
  constructor(private db: PrismaClient) {}

  /** What the sale form and the report filters offer at one site. */
  async options(siteId: string) {
    const [pumps, cuves, nozzles, shifts, accounts] = await Promise.all([
      this.db.tblPump.findMany({
        where: { siteId, status: "active" }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.db.tblCuve.findMany({
        where: { siteId, status: "active" },
        select: { id: true, name: true, balance: true, item: { select: { ...itemSelect.select, baseUnitId: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.db.tblNozzle.findMany({
        where: { status: "active", pump: { siteId, status: "active" }, cuve: { siteId, status: "active" } },
        select: { id: true, name: true, nozzleCode: true, pumpId: true, cuveId: true,
          display: { select: { id: true, name: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      this.db.tblShiftSite.findMany({
        where: { siteId, status: 1, shift: { status: true } },
        select: { id: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } },
        orderBy: { shift: { startAt: "asc" } },
      }),
      // An account with no site serves every site.
      this.db.companyAccount.findMany({
        where: { status: "active", OR: [{ siteId: null }, { siteId }] },
        select: { id: true, code: true, name: true, type: true, siteId: true, requiredReference: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    ]);
    // The price in force for each product, in the unit its tank is measured in.
    const prices = await this.db.itemPrice.findMany({
      where: { status: "active", itemUnit: { status: "active", itemId: { in: cuves.map((cuve) => cuve.item.id) } } },
      select: { price: true, itemUnit: { select: { itemId: true, unitId: true } } },
    });
    const priceOf = (item: { id: string; baseUnitId: string | null }) => {
      const found = prices.find((row) => row.itemUnit.itemId === item.id && row.itemUnit.unitId === item.baseUnitId);
      return found ? Number(found.price) : null;
    };
    return {
      pumps,
      // Each tank with its product and that product's price in force (`null` when none is set).
      cuves: cuves.map(({ item: { baseUnitId, ...item }, ...cuve }) => ({
        ...cuve, item, balance: Number(cuve.balance), price: priceOf({ id: item.id, baseUnitId }),
      })),
      nozzles,
      shifts: shifts.map(presentSiteShift),
      accounts,
    };
  }

  private where(siteId: string, filters: FuelSaleFilters): Prisma.FuelSaleWhereInput {
    return {
      siteId,
      dateOn: {
        gte: filters.startDate ? toDate(filters.startDate) : undefined,
        lte: filters.endDate ? toDate(filters.endDate) : undefined,
      },
      shiftId: filters.shiftId === "none" ? null : filters.shiftId,
      nozzleId: filters.nozzleId,
    };
  }

  /** Sales newest first, with totals for everything the filters match — not just the page. */
  async list(siteId: string, query: FuelSaleListQuery) {
    const where = this.where(siteId, query);
    const [rows, totals] = await Promise.all([
      this.db.fuelSale.findMany({
        where, select: saleSelect, ...paginationArgs(query), orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.fuelSale.aggregate({ where, _count: { _all: true }, _sum: { quantity: true, amount: true } }),
    ]);
    return { ...paginatedData(rows.map(presentSale), totals._count._all, query), summary: figures(totals) };
  }

  async find(id: string, siteId?: string) {
    const sale = await this.db.fuelSale.findFirst({ where: { id, siteId }, select: saleSelect });
    if (!sale) throw new NotFoundError("Fuel sale");
    return presentSale(sale);
  }

  /**
   * Records fuel sold through a pump: the sale itself, one payment row per
   * account the money went to, and the ledger row that takes the litres out of
   * the cuve — the nozzle's when one is given, otherwise the one named. All in
   * one transaction, so stock and money cannot disagree.
   */
  record(input: CreateFuelSale, userId: string, siteId?: string) {
    return this.db.$transaction(async (tx) => {
      const pump = await tx.tblPump.findFirst({
        where: { id: input.pumpId, siteId }, select: { id: true, name: true, siteId: true, status: true },
      });
      if (!pump) throw new NotFoundError("Pump for this site");
      if (pump.status !== "active") throw new BusinessError("PUMP_INACTIVE", `${pump.name} is not active`);

      const cuveSelect = { id: true, name: true, siteId: true, status: true } as const;
      let nozzleId: string | null = null;
      let cuve: Prisma.TblCuveGetPayload<{ select: typeof cuveSelect }> | null;
      if (input.nozzleId) {
        const nozzle = await tx.tblNozzle.findFirst({
          where: { id: input.nozzleId, pumpId: pump.id },
          select: { id: true, name: true, status: true, cuve: { select: cuveSelect } },
        });
        if (!nozzle) throw new BusinessError("NOZZLE_NOT_ON_PUMP", `That nozzle is not on ${pump.name}`);
        if (nozzle.status !== "active") throw new BusinessError("NOZZLE_INACTIVE", `${nozzle.name} is not active`);
        // The nozzle decides the tank; a different one named alongside it is a mistake.
        if (input.cuveId && input.cuveId !== nozzle.cuve.id) {
          throw new BusinessError("NOZZLE_CUVE_MISMATCH", `${nozzle.name} draws from ${nozzle.cuve.name}, not the tank chosen`);
        }
        nozzleId = nozzle.id;
        cuve = nozzle.cuve;
      } else {
        cuve = await tx.tblCuve.findFirst({ where: { id: input.cuveId!, siteId: pump.siteId }, select: cuveSelect });
      }
      if (!cuve || cuve.siteId !== pump.siteId) throw new NotFoundError("Cuve for this site");
      if (cuve.status !== "active") throw new BusinessError("CUVE_INACTIVE", `${cuve.name} is not active`);

      let shiftHours: { startAt: Date; endAt: Date } | null = null;
      if (input.shiftId) {
        const shift = await tx.tblShiftSite.findFirst({
          where: { id: input.shiftId, siteId: cuve.siteId },
          select: { status: true, shift: { select: { startAt: true, endAt: true } } },
        });
        if (!shift) throw new BusinessError("SHIFT_NOT_AT_SITE", "That shift does not run at this site");
        if (shift.status !== 1) throw new BusinessError("SHIFT_SWITCHED_OFF", "That shift is switched off at this site");
        shiftHours = shift.shift;
      }

      const dateOn = input.dateOn ? toDate(input.dateOn) : workingDay(shiftHours);
      if (dateOn > today()) throw new BusinessError("SALE_DAY_IN_FUTURE", "A sale cannot be recorded for a day that has not come yet");

      const amount = money(input.amount);
      const accountIds = input.payments.map((payment) => payment.accountId);
      if (new Set(accountIds).size !== accountIds.length) {
        throw new BusinessError("DUPLICATE_PAYMENT_ACCOUNT", "Each account can only be used once per sale");
      }
      const accounts = await tx.companyAccount.findMany({ where: { id: { in: accountIds } } });
      let paid = new Prisma.Decimal(0);
      for (const payment of input.payments) {
        const account = accounts.find((row) => row.id === payment.accountId);
        if (!account) throw new NotFoundError("Company account");
        if (account.status !== "active") {
          throw new BusinessError("ACCOUNT_INACTIVE", `${account.name} is not active`);
        }
        if (account.siteId && account.siteId !== cuve.siteId) {
          throw new BusinessError("ACCOUNT_NOT_AT_SITE", `${account.name} belongs to another site`);
        }
        if (account.requiredReference && !payment.reference) {
          throw new BusinessError("PAYMENT_REFERENCE_REQUIRED", `${account.name} needs a reference number`);
        }
        paid = paid.plus(money(payment.amount));
      }
      if (!paid.equals(amount)) {
        throw new BusinessError("PAYMENTS_DO_NOT_MATCH",
          `The payments add up to ${paid.toString()}, but the sale is ${amount.toString()}`);
      }

      // Decrement only if there is enough, so two sales at once cannot overdraw the tank.
      const drawn = await tx.tblCuve.updateMany({
        where: { id: cuve.id, balance: { gte: input.quantity } },
        data: { balance: { decrement: input.quantity } },
      });
      if (drawn.count === 0) {
        const current = await tx.tblCuve.findUniqueOrThrow({ where: { id: cuve.id }, select: { balance: true } });
        throw new BusinessError("INSUFFICIENT_CUVE_STOCK",
          `${cuve.name} only holds ${current.balance.toString()}; cannot sell ${input.quantity}`);
      }

      const sale = await tx.fuelSale.create({
        data: {
          siteId: cuve.siteId, nozzleId, pumpId: pump.id, shiftId: input.shiftId ?? null,
          dateOn, quantity: input.quantity, unitPrice: money(input.unitPrice), amount,
          note: input.note || null, createdBy: userId,
          payments: { create: input.payments.map((payment) => ({
            accountId: payment.accountId, amount: money(payment.amount), reference: payment.reference || null,
            referenceDocUrl: payment.referenceDocUrl ?? null,
          })) },
          cuveTransaction: { create: {
            cuveId: cuve.id, quantity: input.quantity, type: "sold", direction: "OUT", createdBy: userId,
          } },
        },
        select: saleSelect,
      });
      const after = await tx.tblCuve.findUniqueOrThrow({ where: { id: cuve.id }, select: { balance: true } });
      const presented = presentSale(sale);
      return { ...presented, cuve: { ...presented.cuve!, balance: Number(after.balance) } };
    });
  }

  /**
   * The period a report covers. With no dates given it is the latest working
   * day: the newest day on the site's time table up to today, or the newest
   * day with a sale if that is later.
   */
  private async period(siteId: string, query: FuelSaleReportQuery) {
    if (query.startDate || query.endDate) {
      const startDate = (query.startDate ?? query.endDate)!;
      return { startDate, endDate: query.endDate ?? startDate, isLatestDay: false };
    }
    const [roster, sale] = await Promise.all([
      this.db.tblTimeTable.aggregate({ where: { siteId, dateOn: { lte: today() } }, _max: { dateOn: true } }),
      this.db.fuelSale.aggregate({ where: { siteId }, _max: { dateOn: true } }),
    ]);
    const days = [roster._max.dateOn, sale._max.dateOn].filter((day): day is Date => day !== null);
    const latest = fromDate(days.length ? new Date(Math.max(...days.map((day) => day.getTime()))) : today());
    return { startDate: latest, endDate: latest, isLatestDay: true };
  }

  /**
   * Everything sold at a site over a period, cut every useful way: by product,
   * by working day, by shift (with who was rostered on it), by pump and nozzle, by the
   * account the money went to, and by who recorded the sale.
   */
  async report(siteId: string, query: FuelSaleReportQuery) {
    const period = await this.period(siteId, query);
    const where = this.where(siteId, { ...period, shiftId: query.shiftId });
    const sums = { _count: { _all: true }, _sum: { quantity: true, amount: true } } as const;
    const days = { gte: toDate(period.startDate), lte: toDate(period.endDate) };

    const [site, totals, byDay, byShift, byPump, byNozzle, bySeller, byAccount, roster, siteShifts, cuves] = await Promise.all([
      this.db.tblSite.findUnique({ where: { id: siteId }, select: { id: true, name: true } }),
      this.db.fuelSale.aggregate({ where, ...sums }),
      this.db.fuelSale.groupBy({ by: ["dateOn"], where, ...sums }),
      this.db.fuelSale.groupBy({ by: ["dateOn", "shiftId"], where, ...sums }),
      this.db.fuelSale.groupBy({ by: ["pumpId"], where, ...sums }),
      this.db.fuelSale.groupBy({ by: ["nozzleId"], where, ...sums }),
      this.db.fuelSale.groupBy({ by: ["createdBy"], where, ...sums }),
      this.db.fuelSalePayment.groupBy({ by: ["accountId"], where: { sale: where }, _count: { _all: true }, _sum: { amount: true } }),
      // Who the time table put on each shift of each day in the period.
      this.db.tblTimeTable.findMany({
        where: { siteId, dateOn: days, siteShiftId: query.shiftId && query.shiftId !== "none" ? query.shiftId : undefined },
        select: { dateOn: true, siteShiftId: true, isChief: true, isSuport: true, user: person },
      }),
      // Switched-off shifts too: an old sale may still sit on one.
      this.db.tblShiftSite.findMany({
        where: { siteId },
        select: { id: true, shift: { select: { name: true, startAt: true, endAt: true } } },
      }),
      this.db.tblCuve.findMany({ where: { siteId }, select: { id: true, name: true, item: itemSelect } }),
    ]);
    if (!site) throw new NotFoundError("Site");

    // A sale's product is its tank's, and the tank is on the ledger row the
    // sale produced — not every sale has a nozzle to read it from.
    const byCuve = await Promise.all(cuves.map((cuve) =>
      this.db.fuelSale.aggregate({ where: { ...where, cuveTransaction: { cuveId: cuve.id } }, ...sums })));

    const [pumps, nozzles, sellers, accounts] = await Promise.all([
      this.db.tblPump.findMany({ where: { id: { in: byPump.map((row) => row.pumpId) } }, select: { id: true, name: true } }),
      this.db.tblNozzle.findMany({
        where: { id: { in: byNozzle.flatMap((row) => row.nozzleId ?? []) } },
        select: { id: true, name: true, nozzleCode: true, pump: { select: { id: true, name: true } },
          cuve: { select: { id: true, name: true, item: itemSelect } } },
      }),
      this.db.user.findMany({ where: { id: { in: bySeller.map((row) => row.createdBy) } }, ...person }),
      this.db.companyAccount.findMany({
        where: { id: { in: byAccount.map((row) => row.accountId) } },
        select: { id: true, code: true, name: true, type: true },
      }),
    ]);

    const shiftOf = new Map(siteShifts.map((row) => [row.id, presentSiteShift(row)]));
    const byAmount = <T extends { amount: number }>(rows: T[]) => rows.sort((a, b) => b.amount - a.amount);

    // One row per shift per day: every shift that sold, plus every shift that
    // was rostered but sold nothing — a quiet shift is information too.
    type ShiftRow = ReturnType<typeof figures> & {
      dateOn: string; shift: ReturnType<typeof presentSiteShift> | null;
      rostered: number; chief: (typeof roster)[number]["user"] | null; supporter: (typeof roster)[number]["user"] | null;
    };
    const shiftRows = new Map<string, ShiftRow>();
    const shiftRow = (dateOn: string, shiftId: string | null) => {
      const key = `${dateOn}|${shiftId ?? ""}`;
      let row = shiftRows.get(key);
      if (!row) {
        row = { dateOn, shift: shiftId ? shiftOf.get(shiftId) ?? null : null,
          rostered: 0, chief: null, supporter: null, saleCount: 0, quantity: 0, amount: 0, averagePrice: 0 };
        shiftRows.set(key, row);
      }
      return row;
    };
    for (const group of byShift) Object.assign(shiftRow(fromDate(group.dateOn), group.shiftId), figures(group));
    const rosteredByDay = new Map<string, number>();
    if (query.shiftId !== "none") {
      for (const entry of roster) {
        const dateOn = fromDate(entry.dateOn);
        const row = shiftRow(dateOn, entry.siteShiftId);
        row.rostered++;
        if (entry.isChief) row.chief = entry.user;
        if (entry.isSuport) row.supporter = entry.user;
        rosteredByDay.set(dateOn, (rosteredByDay.get(dateOn) ?? 0) + 1);
      }
    }

    const dayRows = new Map(byDay.map((group) => [fromDate(group.dateOn), figures(group)]));
    for (const dateOn of rosteredByDay.keys()) {
      if (!dayRows.has(dateOn)) dayRows.set(dateOn, { saleCount: 0, quantity: 0, amount: 0, averagePrice: 0 });
    }

    // Sales recorded without a nozzle are kept together as one row.
    const nozzleRows = byNozzle.map((group) => ({
      ...(nozzles.find((row) => row.id === group.nozzleId)
        ?? { id: "none", name: "No nozzle", nozzleCode: "", pump: null, cuve: null }),
      ...figures(group),
    }));
    const items = new Map<string, { item: (typeof cuves)[number]["item"]; saleCount: number; quantity: Prisma.Decimal; amount: Prisma.Decimal }>();
    cuves.forEach((cuve, index) => {
      const group = byCuve[index];
      if (group._count._all === 0) return;
      const row = items.get(cuve.item.id) ?? { item: cuve.item, saleCount: 0, quantity: zero, amount: zero };
      row.saleCount += group._count._all;
      row.quantity = row.quantity.plus(group._sum.quantity ?? 0);
      row.amount = row.amount.plus(group._sum.amount ?? 0);
      items.set(cuve.item.id, row);
    });

    return {
      site,
      period: { ...period, days: (days.lte.getTime() - days.gte.getTime()) / 86_400_000 + 1 },
      shift: query.shiftId && query.shiftId !== "none" ? shiftOf.get(query.shiftId) ?? null : null,
      totals: figures(totals),
      byItem: byAmount([...items.values()].map((row) => ({
        item: row.item, saleCount: row.saleCount, quantity: Number(row.quantity), amount: Number(row.amount),
        averagePrice: row.quantity.isZero() ? 0 : Number(row.amount.div(row.quantity).toDecimalPlaces(2)),
      }))),
      byDay: [...dayRows.entries()]
        .map(([dateOn, row]) => ({ dateOn, rostered: rosteredByDay.get(dateOn) ?? 0, ...row }))
        .sort((a, b) => b.dateOn.localeCompare(a.dateOn)),
      byShift: [...shiftRows.values()].sort((a, b) =>
        b.dateOn.localeCompare(a.dateOn) || (a.shift?.startAt ?? "99").localeCompare(b.shift?.startAt ?? "99")),
      byPump: byAmount(byPump.map((group) => ({ pump: pumps.find((row) => row.id === group.pumpId)!, ...figures(group) }))),
      byNozzle: byAmount(nozzleRows),
      byAccount: byAmount(byAccount.map((group) => ({
        account: accounts.find((row) => row.id === group.accountId)!,
        paymentCount: group._count._all, amount: Number(group._sum.amount ?? 0),
      }))),
      bySeller: byAmount(bySeller.map((group) => ({ user: sellers.find((row) => row.id === group.createdBy)!, ...figures(group) }))),
    };
  }
}
