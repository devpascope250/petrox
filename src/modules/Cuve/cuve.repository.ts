import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { AuthUser } from "../../shared/auth/context-user.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateCuveSchema, CuveInventoryQuery, CuveTransactionsQuery } from "./cuve.schema.js";
import { presentSale, saleSelect } from "../fuel-sales/fuel-sale.repository.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/pagination.js";

const stockSelect = {
  id: true, name: true, itemId: true, siteId: true, balance: true,
  minimum: true, maximum: true, deadStock: true, status: true,
  item: { select: { id: true, name: true, baseUnit: true } },
  site: { select: { id: true, name: true } },
} satisfies Prisma.TblCuveSelect;

function stockNumbers(cuve: Prisma.TblCuveGetPayload<{ select: typeof stockSelect }>) {
  return { ...cuve, balance: Number(cuve.balance), minimum: Number(cuve.minimum),
    maximum: Number(cuve.maximum), deadStock: Number(cuve.deadStock) };
}

/** A ledger row with whatever caused it: the sale, or the delivery received. */
const transactionInclude = {
  user: { select: { id: true, firstName: true, lastName: true } },
  sale: { select: saleSelect },
  orderReception: { select: { id: true, loadingOrderId: true } },
} satisfies Prisma.CuveTransactionInclude;

function presentTransaction(row: Prisma.CuveTransactionGetPayload<{ include: typeof transactionInclude }>) {
  return { ...row, quantity: Number(row.quantity), sale: row.sale ? presentSale(row.sale) : null };
}

export class CuveRepository {
  constructor(private db: PrismaClient) {}

  async stocks(query: { siteId: string }) {
    const cuves = await this.db.tblCuve.findMany({
      where: { siteId: query.siteId },
      select: stockSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const totals = new Map<string, { item: typeof cuves[number]["item"]; balance: Prisma.Decimal; cuveCount: number }>();
    for (const cuve of cuves) {
      const total = totals.get(cuve.itemId) ?? { item: cuve.item, balance: new Prisma.Decimal(0), cuveCount: 0 };
      total.balance = total.balance.plus(cuve.balance);
      total.cuveCount++;
      totals.set(cuve.itemId, total);
    }
    return {
      cuves: cuves.map(stockNumbers),
      summary: { cuveCount: cuves.length, items: [...totals.values()].map((total) => ({
        ...total, balance: Number(total.balance),
      })) },
    };
  }

  /**
   * The stock sheet for a site over a period, tank by tank and added up per
   * product: what each tank opened with, what was delivered into it, what was
   * sold out of it and for how much, what it closed with, and where it stands
   * now against its capacity and dead stock.
   *
   * Every figure comes from the ledger (`CuveTransaction`); the money comes
   * from the sales those rows point at.
   */
  async inventory(siteId: string, query: CuveInventoryQuery) {
    const site = await this.db.tblSite.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
    if (!site) throw new NotFoundError("Site");
    const cuves = await this.db.tblCuve.findMany({
      where: { siteId },
      select: { ...stockSelect, _count: { select: { nozzles: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const cuveId = { in: cuves.map((cuve) => cuve.id) };
    const createdAt = { gte: query.startDate, lte: query.endDate };
    /** Litres and number of movements per tank and direction. */
    const grouped = (where: Prisma.CuveTransactionWhereInput) => this.db.cuveTransaction.groupBy({
      by: ["cuveId", "direction"], where, _sum: { quantity: true }, _count: { _all: true },
    });

    const [moved, movedLater, movedEver, sales] = await Promise.all([
      grouped({ cuveId, createdAt }),
      query.endDate ? grouped({ cuveId, createdAt: { gt: query.endDate } }) : Promise.resolve([]),
      grouped({ cuveId }),
      // Money sits on the sale, reached through the ledger row that drew the litres.
      Promise.all(cuves.map((cuve) => this.db.fuelSale.aggregate({
        where: { cuveTransaction: { cuveId: cuve.id, createdAt } }, _sum: { amount: true },
      }))),
    ]);

    const zero = new Prisma.Decimal(0);
    const pick = (rows: typeof moved, id: string, direction: "IN" | "OUT") =>
      rows.find((row) => row.cuveId === id && row.direction === direction);
    const quantity = (rows: typeof moved, id: string, direction: "IN" | "OUT") =>
      pick(rows, id, direction)?._sum.quantity ?? zero;
    const net = (rows: typeof moved, id: string) => quantity(rows, id, "IN").minus(quantity(rows, id, "OUT"));

    const rows = cuves.map(({ _count, ...cuve }, index) => {
      const received = quantity(moved, cuve.id, "IN");
      const sold = quantity(moved, cuve.id, "OUT");
      // Work back from today's balance: undo what moved after the period to get
      // the closing figure, then undo the period itself to get the opening one.
      const closing = cuve.balance.minus(net(movedLater, cuve.id));
      const opening = closing.minus(received).plus(sold);
      return {
        cuve, nozzleCount: _count.nozzles, opening, received, sold, closing,
        receptionCount: pick(moved, cuve.id, "IN")?._count._all ?? 0,
        saleCount: pick(moved, cuve.id, "OUT")?._count._all ?? 0,
        salesAmount: sales[index]._sum.amount ?? zero,
        // Stock the ledger cannot explain: a balance that was set by hand, say.
        unrecorded: cuve.balance.minus(net(movedEver, cuve.id)),
      };
    });

    type Row = (typeof rows)[number];
    const figures = (row: Pick<Row, "opening" | "received" | "sold" | "closing" | "salesAmount" | "receptionCount" | "saleCount" | "unrecorded">) => ({
      opening: Number(row.opening), received: Number(row.received), sold: Number(row.sold),
      closing: Number(row.closing), totalStock: Number(row.opening.plus(row.received)),
      salesAmount: Number(row.salesAmount), receptionCount: row.receptionCount, saleCount: row.saleCount,
      unrecorded: Number(row.unrecorded),
    });
    const standing = (list: Row[]) => {
      const sum = (value: (row: Row) => Prisma.Decimal) => Number(list.reduce((total, row) => total.plus(value(row)), zero));
      return {
        currentBalance: sum((row) => row.cuve.balance),
        capacity: sum((row) => row.cuve.maximum),
        deadStock: sum((row) => row.cuve.deadStock),
        // What can still be pumped: nothing below the dead stock comes out.
        usable: sum((row) => Prisma.Decimal.max(row.cuve.balance.minus(row.cuve.deadStock), 0)),
        space: sum((row) => Prisma.Decimal.max(row.cuve.maximum.minus(row.cuve.balance), 0)),
      };
    };
    const add = (list: Row[]) => list.reduce((total, row) => ({
      opening: total.opening.plus(row.opening), received: total.received.plus(row.received),
      sold: total.sold.plus(row.sold), closing: total.closing.plus(row.closing),
      salesAmount: total.salesAmount.plus(row.salesAmount), unrecorded: total.unrecorded.plus(row.unrecorded),
      receptionCount: total.receptionCount + row.receptionCount, saleCount: total.saleCount + row.saleCount,
    }), { opening: zero, received: zero, sold: zero, closing: zero, salesAmount: zero, unrecorded: zero, receptionCount: 0, saleCount: 0 });

    const byItem = new Map<string, Row[]>();
    for (const row of rows) byItem.set(row.cuve.itemId, [...(byItem.get(row.cuve.itemId) ?? []), row]);

    return {
      site,
      period: { startDate: query.startDate ?? null, endDate: query.endDate ?? null },
      items: [...byItem.values()].map((list) => ({
        item: list[0].cuve.item,
        cuveCount: list.length,
        ...figures(add(list)),
        ...standing(list),
        cuves: list.map((row) => ({
          ...stockNumbers(row.cuve), nozzleCount: row.nozzleCount, ...figures(row), ...standing([row]),
        })),
      })).sort((a, b) => a.item.name.localeCompare(b.item.name)),
      totals: { cuveCount: rows.length, ...figures(add(rows)), ...standing(rows) },
    };
  }

  transactions(id: string, query: CuveTransactionsQuery, siteId?: string) {
    return this.db.$transaction(async (tx) => {
      const cuve = await tx.tblCuve.findFirst({ where: { id, siteId }, select: stockSelect });
      if (!cuve) throw new NotFoundError("Cuve for this site");
      const where: Prisma.CuveTransactionWhereInput = {
        cuveId: id, createdAt: { gte: query.startDate, lte: query.endDate },
      };
      const [rows, total, movements, sales, laterMovements] = await Promise.all([
        tx.cuveTransaction.findMany({
          where, include: transactionInclude, ...paginationArgs(query), orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        tx.cuveTransaction.count({ where }),
        tx.cuveTransaction.groupBy({ by: ["direction"], where, _sum: { quantity: true } }),
        // Money is on the sale, not the ledger row, so it is summed from there.
        tx.fuelSale.aggregate({ where: { cuveTransaction: where }, _sum: { amount: true } }),
        query.endDate ? tx.cuveTransaction.groupBy({
          by: ["direction"], where: { cuveId: id, createdAt: { gt: query.endDate } }, _sum: { quantity: true },
        }) : Promise.resolve([]),
      ]);
      const totalIn = movements.find((row) => row.direction === "IN")?._sum.quantity ?? new Prisma.Decimal(0);
      const totalOut = movements.find((row) => row.direction === "OUT")?._sum.quantity ?? new Prisma.Decimal(0);
      const salesAmount = sales._sum.amount ?? new Prisma.Decimal(0);
      const netMovement = totalIn.minus(totalOut);
      const laterNet = laterMovements.reduce((sum, row) => row.direction === "IN"
        ? sum.plus(row._sum.quantity ?? 0) : sum.minus(row._sum.quantity ?? 0), new Prisma.Decimal(0));
      const closingBalance = cuve.balance.minus(laterNet);
      return {
        cuve: stockNumbers(cuve),
        ...paginatedData(rows.map(presentTransaction), total, query),
        summary: {
          startDate: query.startDate ?? null, endDate: query.endDate ?? null,
          transactionCount: total, totalIn: Number(totalIn), totalOut: Number(totalOut),
          salesAmount: Number(salesAmount),
          netMovement: Number(netMovement), openingBalance: Number(closingBalance.minus(netMovement)),
          closingBalance: Number(closingBalance), currentBalance: Number(cuve.balance),
        },
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  async list(actor: AuthUser) {
    let whereClause: { siteId: string } | Record<string, never> = {};

    if (actor.position === "siteManager") {
      if (!actor.siteId) throw new NotFoundError("Site not found for the current user.");
      whereClause = { siteId: actor.siteId };
    }

    return await this.db.tblCuve.
    findMany({
      orderBy: { createdAt: "desc" },
      where: whereClause,
      select: {
        id: true,
        name: true,
        item: true,
        minimum: true,
        maximum: true,
        deadStock: true,
        site: true,
        status: true,
        createdAt: true,
      },
    });
  }

  create(data: CreateCuveSchema) {
    return this.db.tblCuve.create({
      data: {
        name: data.name,
        itemId: data.itemId,
        minimum: data.minimum,
        maximum: data.maximum,
        deadStock: data.deadStock,
        siteId: data.siteId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateCuveSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblCuve.update({
      where: { id: id },
      data: {
        name: data.name,
        itemId: data.itemId,
        minimum: data.minimum,
        maximum: data.maximum,
        deadStock: data.deadStock,
        siteId: data.siteId,
        status: "active",
      },
    });
  }


  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblCuve.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblCuve.findUnique({ where: { id } });
  }
}
