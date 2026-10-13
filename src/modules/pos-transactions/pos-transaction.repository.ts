import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { staticUrl } from "../../utils/static-url.js";
import type { PosTransactionListQuery } from "./pos-transaction.schema.js";

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
  platePictureUrl: true, displayPictureUrl: true, subsidyRate: true,
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

/** `08:00` from a `TIME` column, which Prisma reads as a date on 1 Jan 1970 (UTC). */
const clock = (time: Date) => time.toISOString().slice(11, 16);

function presentRow<T extends Row>({ cardCopy, ...row }: T) {
  const used = cardCopy ? (cardCopy.copyCard ?? cardCopy.card) : null;
  return {
    ...row,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unitPrice),
    amount: Number(row.amount),
    discountAmount: Number(row.discountAmount),
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
  /** `staticBase` is put in front of stored picture and document paths. */
  constructor(private db: PrismaClient, private staticBase?: string) {}

  private where(siteId: string | undefined, query: PosTransactionListQuery): Prisma.GeneralTransactionWhereInput {
    const search = query.search || undefined;
    return {
      ...(siteId ? { siteId } : {}),
      ...(query.status ? { status: query.status } : {}),
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
      subsidyRate: Number(sale.subsidyRate),
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
}
