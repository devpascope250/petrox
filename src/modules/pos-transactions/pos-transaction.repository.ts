import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { staticUrl } from "../../utils/static-url.js";
import { CompanySettingsRepository } from "../company-settings/company-settings.repository.js";
import { WALK_IN, type PosTransactionListQuery, type PosTransactionReportQuery } from "./pos-transaction.schema.js";

const person = { select: { id: true, firstName: true, lastName: true, phone: true } } as const;
const physicalCard = { select: { id: true, cardNumber: true, serialNumber: true } } as const;

/** A sale as a row of the report. */
const rowSelect = {
  id: true, transactionCode: true, status: true, platNumber: true,
  quantity: true, unitPrice: true, amount: true, discountAmount: true, subsidyAmount: true,
  createdAt: true, confirmedAt: true,
  item: { select: { id: true, name: true } },
  site: { select: { id: true, name: true } },
  pump: { select: { id: true, name: true } },
  nozzle: { select: { id: true, name: true, nozzleCode: true } },
  client: { select: { id: true, clientCode: true, name: true } },
  // The main card is `card`; for a copy, the copy used at the pump is `copyCard`.
  cardCopy: { select: { id: true, card: physicalCard, copyCard: physicalCard } },
  user: person,
} satisfies Prisma.GeneralTransactionSelect;

/** Everything recorded about one sale. */
const detailSelect = {
  ...rowSelect,
  platePictureUrl: true, displayPictureUrl: true, subsidyRate: true, discountRate: true,
  discount: { select: { id: true, type: true, value: true, validFrom: true, validTo: true } },
  reason: true, comments: true, printStatus: true, appVersion: true, updatedAt: true,
  item: { select: { id: true, name: true, baseUnit: { select: { id: true, name: true, code: true } } } },
  cuve: { select: { id: true, name: true } },
  nozzle: { select: { id: true, name: true, nozzleCode: true, display: { select: { id: true, name: true, code: true } } } },
  client: { select: { id: true, clientCode: true, name: true, phone: true, email: true } },
  cardCopy: { select: {
    id: true, lastIndex: true,
    card: { select: { ...physicalCard.select, balance: true, cardType: { select: { id: true, name: true } } } },
    copyCard: physicalCard,
  } },
  shift: { select: { id: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } } },
  device: { select: { id: true, deviceName: true } },
  generalTransactionPayments: {
    select: { id: true, amount: true, reference: true, referenceDocUrl: true,
      account: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GeneralTransactionSelect;

type Row = Prisma.GeneralTransactionGetPayload<{ select: typeof rowSelect }>;
type Detail = Prisma.GeneralTransactionGetPayload<{ select: typeof detailSelect }>;

/**
 * How many sales the financial report lists one by one, newest first. The
 * totals and breakdowns always cover **everything** the filters match; only
 * the detail list is capped, so a year's filter still prints a usable report
 * rather than ten thousand pages.
 */
const REPORT_ROW_LIMIT = 2000;

/**
 * Rwanda keeps UTC+2 all year, so a business day runs from 02:00 UTC to
 * 02:00 UTC — the same offset the dashboard counts days by.
 */
const BUSINESS_OFFSET_MINUTES = 120;

/** The business day a sale falls on, as `YYYY-MM-DD`. */
const businessDay = (at: Date) =>
  new Date(at.getTime() + BUSINESS_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

/** A sale as the financial report lists it: the row fields, and how it was paid. */
const reportRowSelect = {
  ...rowSelect,
  discountRate: true, subsidyRate: true, printStatus: true, reason: true,
  item: { select: { id: true, name: true, baseUnit: { select: { id: true, name: true, code: true } } } },
  shift: { select: { id: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } } },
  device: { select: { id: true, deviceName: true } },
  generalTransactionPayments: {
    select: { id: true, amount: true, reference: true,
      account: { select: { id: true, code: true, name: true, type: true } } },
    orderBy: { createdAt: "asc" },
  },
  couponRedemptions: {
    select: { id: true, amount: true, clientCoupon: { select: { id: true, code: true } } },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GeneralTransactionSelect;

type ReportRow = Prisma.GeneralTransactionGetPayload<{ select: typeof reportRowSelect }>;

const zero = new Prisma.Decimal(0);

/**
 * One group's totals as plain numbers, with the average price they imply.
 *
 * A discount and a subsidy are **recorded, not deducted**, so `amount` is what
 * the pumps showed and what was collected; `grossAmount` is the same figure,
 * kept for the screens and printouts that show the two side by side.
 */
function figures(group: {
  _count: { _all: number };
  _sum: {
    quantity: Prisma.Decimal | null; amount: Prisma.Decimal | null;
    discountAmount: Prisma.Decimal | null; subsidyAmount: Prisma.Decimal | null;
  };
}) {
  const quantity = group._sum.quantity ?? zero;
  const amount = group._sum.amount ?? zero;
  return {
    saleCount: group._count._all,
    quantity: Number(quantity),
    amount: Number(amount),
    grossAmount: Number(amount),
    discountAmount: Number(group._sum.discountAmount ?? zero),
    subsidyAmount: Number(group._sum.subsidyAmount ?? zero),
    averagePrice: quantity.isZero() ? 0 : Number(amount.div(quantity).toDecimalPlaces(2)),
  };
}

/** The empty figures a group that sold nothing still shows. */
const noFigures = () => ({
  saleCount: 0, quantity: 0, amount: 0, grossAmount: 0, discountAmount: 0, subsidyAmount: 0, averagePrice: 0,
});

/** Biggest earner first: how a financial report is read. */
const byAmount = <T extends { amount: number }>(rows: T[]) => rows.sort((a, b) => b.amount - a.amount);

/**
 * A sale as the financial report prints it: the row's own figures, the rates
 * behind the discount and the subsidy, and everything it was settled with —
 * each payment with the account it went to, and each coupon it took from.
 */
function presentReportRow(sale: ReportRow) {
  const { generalTransactionPayments, couponRedemptions, shift, ...rest } = sale;
  return {
    ...presentRow(rest),
    /** The percentage off, as the discount stood when the sale was priced. */
    discountRate: Number(sale.discountRate),
    /** Towards each unit sold: a fixed amount a litre, never a percentage. */
    subsidyRate: Number(sale.subsidyRate),
    shift: shift
      ? { id: shift.id, name: shift.shift.name, startAt: clock(shift.shift.startAt), endAt: clock(shift.shift.endAt) }
      : null,
    payments: generalTransactionPayments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    coupons: couponRedemptions.map((redemption) => ({
      id: redemption.id, amount: Number(redemption.amount), code: redemption.clientCoupon.code,
    })),
  };
}

/** `08:00` from a `TIME` column, which Prisma reads as a date on 1 Jan 1970 (UTC). */
const clock = (time: Date) => time.toISOString().slice(11, 16);

function presentRow<T extends Row>({ cardCopy, ...row }: T) {
  const used = cardCopy ? (cardCopy.copyCard ?? cardCopy.card) : null;
  return {
    ...row,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    /** What was collected — the full pump amount. */
    amount: Number(row.amount),
    /**
     * What the discount came to. **Recorded, not deducted**: it was not taken
     * off `amount`, which is why `grossAmount` is the same figure.
     */
    discountAmount: Number(row.discountAmount),
    /** What the pump display showed — the same as `amount`. */
    grossAmount: Number(row.amount),
    /** `quantity × subsidyRate`, recorded the same way. */
    subsidyAmount: Number(row.subsidyAmount),
    card: cardCopy ? {
      cardCopyId: cardCopy.id.toString(),
      /** The card swiped at the pump: the copy for a copy, the main card otherwise. */
      used: { id: used!.id.toString(), cardNumber: used!.cardNumber, serialNumber: used!.serialNumber },
      isCopy: cardCopy.copyCard !== null,
    } : null,
  };
}

/**
 * POS sales (`GeneralTransaction`) read from the web: the report and one sale
 * in full. Recording them stays with the POS (`/mobile/transactions`).
 */
export class PosTransactionRepository {
  /**
   * The company profile the report is printed under: the same letterhead a POS
   * receipt carries, so one profile answers for both.
   */
  private company: CompanySettingsRepository;

  /** `staticBase` is put in front of stored picture and document paths. */
  constructor(private db: PrismaClient, private staticBase?: string) {
    this.company = new CompanySettingsRepository(db);
  }

  /** The filters both the report and the paged list narrow by. */
  private where(siteId: string | undefined, query: PosTransactionReportQuery): Prisma.GeneralTransactionWhereInput {
    const search = query.search || undefined;
    /** A sale carries one when its recorded amount is more than nothing. */
    const carrying = (has: boolean | undefined) =>
      has === undefined ? undefined : has ? { gt: new Prisma.Decimal(0) } : { lte: new Prisma.Decimal(0) };
    return {
      ...(siteId ? { siteId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId === WALK_IN ? null : query.clientId } : {}),
      ...(query.hasDiscount === undefined ? {} : { discountAmount: carrying(query.hasDiscount) }),
      ...(query.hasSubsidy === undefined ? {} : { subsidyAmount: carrying(query.hasSubsidy) }),
      ...(query.startDate || query.endDate ? { createdAt: { gte: query.startDate, lte: query.endDate } } : {}),
      ...(search ? { OR: [
        { transactionCode: { contains: search } },
        { platNumber: { contains: search } },
        { client: { name: { contains: search } } },
        { cardCopy: { card: { cardNumber: { contains: search } } } },
        { cardCopy: { copyCard: { cardNumber: { contains: search } } } },
      ] } : {}),
    };
  }

  /**
   * A page of sales, newest first, with totals over everything the filters
   * match. Quantity and money are counted for confirmed sales only: an
   * initiated sale has none yet, and a cancelled one never happened.
   */
  async list(siteId: string | undefined, query: PosTransactionListQuery) {
    const where = this.where(siteId, query);
    const [rows, total, byStatus] = await this.db.$transaction([
      this.db.generalTransaction.findMany({
        where, ...paginationArgs(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: rowSelect,
      }),
      this.db.generalTransaction.count({ where }),
      this.db.generalTransaction.groupBy({
        by: ["status"], where, orderBy: { status: "asc" },
        _count: { _all: true },
        _sum: { quantity: true, amount: true, discountAmount: true, subsidyAmount: true },
      }),
    ]);

    const counts = { initiated: 0, confirmed: 0, cancelled: 0 };
    for (const group of byStatus) {
      counts[group.status] = typeof group._count === "object" ? group._count._all ?? 0 : 0;
    }
    const confirmed = byStatus.find((group) => group.status === "confirmed")?._sum;
    const quantity = Number(confirmed?.quantity ?? 0);
    const amount = Number(confirmed?.amount ?? 0);

    return {
      summary: {
        transactionCount: total,
        countsByStatus: counts,
        quantity,
        amount,
        discountAmount: Number(confirmed?.discountAmount ?? 0),
        subsidyAmount: Number(confirmed?.subsidyAmount ?? 0),
        averagePrice: quantity === 0 ? 0 : Math.round((amount / quantity) * 100) / 100,
      },
      ...paginatedData(rows.map((row) => presentRow(row)), total, query),
    };
  }

  /** One sale with everything about it; pictures and documents as full URLs. */
  async find(id: string, siteId: string | undefined) {
    const sale = await this.db.generalTransaction.findFirst({
      where: { id, ...(siteId ? { siteId } : {}) },
      select: detailSelect,
    });
    if (!sale) throw new NotFoundError("Transaction");
    return this.presentDetail(sale);
  }

  private presentDetail(sale: Detail) {
    const url = (path: string | null) => staticUrl(this.staticBase, path);
    const { generalTransactionPayments, shift, ...rest } = sale;
    const { cardCopy } = sale;
    return {
      ...presentRow(rest),
      /** Towards each unit sold: a fixed amount a litre, not a percentage. */
      subsidyRate: Number(sale.subsidyRate),
      /** The percentage off, recorded against the sale. */
      discountRate: Number(sale.discountRate),
      /** The discount that priced it — the figures above are the sale's own. */
      discount: sale.discount && { ...sale.discount, value: Number(sale.discount.value) },
      platePictureUrl: url(sale.platePictureUrl),
      displayPictureUrl: url(sale.displayPictureUrl),
      /** The main card the sale spent from, with its current balance. */
      mainCard: cardCopy ? {
        id: cardCopy.card.id.toString(),
        cardNumber: cardCopy.card.cardNumber,
        serialNumber: cardCopy.card.serialNumber,
        balance: Number(cardCopy.card.balance),
        cardType: cardCopy.card.cardType,
      } : null,
      shift: shift ? {
        id: shift.id, name: shift.shift.name, startAt: clock(shift.shift.startAt), endAt: clock(shift.shift.endAt),
      } : null,
      payments: generalTransactionPayments.map((payment) => ({
        ...payment, amount: Number(payment.amount), referenceDocUrl: url(payment.referenceDocUrl),
      })),
    };
  }

  /**
   * The financial report behind the printed PDF: everything the filters match,
   * cut every way finance reads it — by site, product, business day, shift,
   * pump, nozzle, attendant, client and the account the money went to — with
   * the sales themselves listed one by one underneath.
   *
   * Quantity and money are counted for **confirmed** sales only: an initiated
   * sale has collected nothing yet and a cancelled one never happened. How
   * many sales sit in each status is counted over every sale the filters
   * match, so nothing is hidden from the page.
   *
   * A discount and a subsidy are **recorded, not deducted**: `amount` is what
   * the pump showed and what was collected, and the two are listed beside it
   * as what remains to settle or claim.
   */
  async report(siteId: string | undefined, query: PosTransactionReportQuery) {
    const where = this.where(siteId, query);
    const sold: Prisma.GeneralTransactionWhereInput = { ...where, status: "confirmed" };
    const sums = { _count: { _all: true },
      _sum: { quantity: true, amount: true, discountAmount: true, subsidyAmount: true } } as const;
    const group = <K extends Prisma.GeneralTransactionScalarFieldEnum>(by: K[]) =>
      this.db.generalTransaction.groupBy({ by, where: sold, ...sums });

    const [
      total, byStatus, totals, bySiteGroup, byItemGroup, byPumpGroup, byNozzleGroup,
      byShiftGroup, byAttendantGroup, byClientGroup, byAccountGroup, couponTotals, days, rows, company,
    ] = await Promise.all([
      this.db.generalTransaction.count({ where }),
      this.db.generalTransaction.groupBy({ by: ["status"], where, orderBy: { status: "asc" }, ...sums }),
      this.db.generalTransaction.aggregate({ where: sold, ...sums }),
      group(["siteId"]),
      group(["itemId"]),
      group(["pumpId"]),
      group(["nozzleId"]),
      group(["shiftId"]),
      group(["doneBy"]),
      group(["clientId"]),
      this.db.generalTransactionPayment.groupBy({
        by: ["accountId"], where: { transaction: sold }, _count: { _all: true }, _sum: { amount: true },
      }),
      this.db.couponRedemption.aggregate({ where: { generalTransaction: sold }, _count: { _all: true }, _sum: { amount: true } }),
      // Grouping by business day is a date calculation MySQL cannot do through
      // `groupBy`, so the days are added up here from the figures alone.
      this.db.generalTransaction.findMany({
        where: sold,
        select: { createdAt: true, quantity: true, amount: true, discountAmount: true, subsidyAmount: true },
      }),
      // The detail list, newest first — every status, so a cancelled sale is
      // on the report too.
      this.db.generalTransaction.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: REPORT_ROW_LIMIT, select: reportRowSelect,
      }),
      // The letterhead: empty until the company profile has been saved once.
      this.company.receipt(this.staticBase),
    ]);

    const [sites, items, pumps, nozzles, shifts, attendants, clients, accounts] = await Promise.all([
      this.db.tblSite.findMany({ where: { id: { in: bySiteGroup.map((row) => row.siteId) } },
        select: { id: true, name: true } }),
      this.db.item.findMany({ where: { id: { in: byItemGroup.map((row) => row.itemId) } },
        select: { id: true, name: true, baseUnit: { select: { id: true, name: true, code: true } } } }),
      this.db.tblPump.findMany({ where: { id: { in: byPumpGroup.map((row) => row.pumpId) } },
        select: { id: true, name: true, site: { select: { id: true, name: true } } } }),
      this.db.tblNozzle.findMany({ where: { id: { in: byNozzleGroup.map((row) => row.nozzleId) } },
        select: { id: true, name: true, nozzleCode: true, pump: { select: { id: true, name: true } } } }),
      this.db.tblShiftSite.findMany({ where: { id: { in: byShiftGroup.flatMap((row) => row.shiftId ?? []) } },
        select: { id: true, shift: { select: { name: true, startAt: true, endAt: true } } } }),
      this.db.user.findMany({ where: { id: { in: byAttendantGroup.flatMap((row) => row.doneBy ?? []) } },
        select: { id: true, firstName: true, lastName: true, phone: true } }),
      this.db.client.findMany({ where: { id: { in: byClientGroup.flatMap((row) => row.clientId ?? []) } },
        select: { id: true, clientCode: true, name: true } }),
      this.db.companyAccount.findMany({ where: { id: { in: byAccountGroup.map((row) => row.accountId) } },
        select: { id: true, code: true, name: true, type: true } }),
    ]);

    const counts = { initiated: 0, confirmed: 0, cancelled: 0 };
    for (const row of byStatus) {
      counts[row.status] = typeof row._count === "object" ? row._count._all ?? 0 : 0;
    }
    /** A cancelled sale's figures: shown so the page is not asked to trust that it was nothing. */
    const cancelled = byStatus.find((row) => row.status === "cancelled");
    const initiated = byStatus.find((row) => row.status === "initiated");

    const dayRows = new Map<string, ReturnType<typeof noFigures> & { quantityDecimal: Prisma.Decimal; amountDecimal: Prisma.Decimal }>();
    for (const sale of days) {
      const key = businessDay(sale.createdAt);
      const row = dayRows.get(key) ?? { ...noFigures(), quantityDecimal: zero, amountDecimal: zero };
      row.saleCount++;
      row.quantityDecimal = row.quantityDecimal.plus(sale.quantity);
      row.amountDecimal = row.amountDecimal.plus(sale.amount);
      row.discountAmount = Number(new Prisma.Decimal(row.discountAmount).plus(sale.discountAmount));
      row.subsidyAmount = Number(new Prisma.Decimal(row.subsidyAmount).plus(sale.subsidyAmount));
      dayRows.set(key, row);
    }

    const payments = byAccountGroup.reduce((sum, row) => sum.plus(row._sum.amount ?? zero), zero);
    const coupons = couponTotals._sum.amount ?? zero;
    const collected = Number(totals._sum.amount ?? zero);

    /** The client the report was narrowed to, named for the printed header. */
    const narrowedClient = query.clientId && query.clientId !== WALK_IN
      ? clients.find((client) => client.id === query.clientId)
        ?? await this.db.client.findUnique({
          where: { id: query.clientId }, select: { id: true, clientCode: true, name: true } })
      : null;

    return {
      generatedAt: new Date(),
      /** Who the report is printed under; empty until the profile is saved. */
      company,
      filters: {
        site: siteId ? sites.find((site) => site.id === siteId)
          ?? await this.db.tblSite.findUnique({ where: { id: siteId }, select: { id: true, name: true } }) : null,
        status: query.status ?? null,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        search: query.search ?? null,
        /** `walkIn` when the report was narrowed to the sales with no client. */
        client: narrowedClient,
        walkInOnly: query.clientId === WALK_IN,
        hasDiscount: query.hasDiscount ?? null,
        hasSubsidy: query.hasSubsidy ?? null,
      },
      totals: {
        ...figures(totals),
        /** Every sale the filters match, confirmed or not. */
        transactionCount: total,
        countsByStatus: counts,
        initiatedAmount: Number(initiated?._sum.amount ?? zero),
        cancelledAmount: Number(cancelled?._sum.amount ?? zero),
      },
      /**
       * What the confirmed sales were settled with, against what they came to.
       * `difference` should be zero: the payments and coupons against a sale
       * have to add up to the full pump amount, discounts and subsidies being
       * recorded rather than deducted. Anything else is worth chasing.
       */
      collected: {
        amount: collected,
        payments: Number(payments),
        coupons: Number(coupons),
        couponRedemptions: couponTotals._count._all,
        settled: Number(payments.plus(coupons)),
        difference: Number(payments.plus(coupons).minus(collected)),
      },
      bySite: byAmount(bySiteGroup.map((row) => ({
        site: sites.find((site) => site.id === row.siteId) ?? { id: row.siteId, name: "Unknown site" },
        ...figures(row),
      }))),
      byItem: byAmount(byItemGroup.map((row) => ({
        item: items.find((item) => item.id === row.itemId) ?? { id: row.itemId, name: "Unknown product", baseUnit: null },
        ...figures(row),
      }))),
      byDay: [...dayRows.entries()]
        .map(([dateOn, row]) => ({
          dateOn,
          saleCount: row.saleCount,
          quantity: Number(row.quantityDecimal),
          amount: Number(row.amountDecimal),
          grossAmount: Number(row.amountDecimal),
          discountAmount: row.discountAmount,
          subsidyAmount: row.subsidyAmount,
          averagePrice: row.quantityDecimal.isZero() ? 0
            : Number(row.amountDecimal.div(row.quantityDecimal).toDecimalPlaces(2)),
        }))
        .sort((a, b) => b.dateOn.localeCompare(a.dateOn)),
      byShift: byAmount(byShiftGroup.map((row) => {
        const found = shifts.find((shift) => shift.id === row.shiftId);
        return {
          shift: found ? { id: found.id, name: found.shift.name,
            startAt: clock(found.shift.startAt), endAt: clock(found.shift.endAt) } : null,
          ...figures(row),
        };
      })),
      byPump: byAmount(byPumpGroup.map((row) => ({
        pump: pumps.find((pump) => pump.id === row.pumpId) ?? { id: row.pumpId, name: "Unknown pump", site: null },
        ...figures(row),
      }))),
      byNozzle: byAmount(byNozzleGroup.map((row) => ({
        nozzle: nozzles.find((nozzle) => nozzle.id === row.nozzleId)
          ?? { id: row.nozzleId, name: "Unknown nozzle", nozzleCode: "", pump: null },
        ...figures(row),
      }))),
      byAttendant: byAmount(byAttendantGroup.map((row) => ({
        user: attendants.find((user) => user.id === row.doneBy) ?? null,
        ...figures(row),
      }))),
      byClient: byAmount(byClientGroup.map((row) => ({
        /** Empty for the sales paid at the pump by someone with no account. */
        client: clients.find((client) => client.id === row.clientId) ?? null,
        ...figures(row),
      }))),
      byAccount: byAmount(byAccountGroup.map((row) => ({
        account: accounts.find((account) => account.id === row.accountId)
          ?? { id: row.accountId, code: "", name: "Unknown account", type: null },
        paymentCount: row._count._all,
        amount: Number(row._sum.amount ?? zero),
      }))),
      /** Newest first, and capped: `truncated` says the list is not all of them. */
      rows: rows.map((row) => presentReportRow(row)),
      rowLimit: REPORT_ROW_LIMIT,
      truncated: total > rows.length,
    };
  }
}
