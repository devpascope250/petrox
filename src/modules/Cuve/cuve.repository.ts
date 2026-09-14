import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { AuthUser } from "../../shared/auth/context-user.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateCuveSchema, CuveTransactionsQuery } from "./cuve.schema.js";
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

  transactions(id: string, query: CuveTransactionsQuery, siteId?: string) {
    return this.db.$transaction(async (tx) => {
      const cuve = await tx.tblCuve.findFirst({ where: { id, siteId }, select: stockSelect });
      if (!cuve) throw new NotFoundError("Cuve for this site");
      const where: Prisma.CuveTransactionWhereInput = {
        cuveId: id, createdAt: { gte: query.startDate, lte: query.endDate },
      };
      const [rows, total, movements, laterMovements] = await Promise.all([
        tx.cuveTransaction.findMany({ where, ...paginationArgs(query), orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
        tx.cuveTransaction.count({ where }),
        tx.cuveTransaction.groupBy({ by: ["direction"], where, _sum: { quantity: true } }),
        query.endDate ? tx.cuveTransaction.groupBy({
          by: ["direction"], where: { cuveId: id, createdAt: { gt: query.endDate } }, _sum: { quantity: true },
        }) : Promise.resolve([]),
      ]);
      const totalIn = movements.find((row) => row.direction === "IN")?._sum.quantity ?? new Prisma.Decimal(0);
      const totalOut = movements.find((row) => row.direction === "OUT")?._sum.quantity ?? new Prisma.Decimal(0);
      const netMovement = totalIn.minus(totalOut);
      const laterNet = laterMovements.reduce((sum, row) => row.direction === "IN"
        ? sum.plus(row._sum.quantity ?? 0) : sum.minus(row._sum.quantity ?? 0), new Prisma.Decimal(0));
      const closingBalance = cuve.balance.minus(laterNet);
      return {
        cuve: stockNumbers(cuve),
        ...paginatedData(rows.map((row) => ({ ...row, quantity: Number(row.quantity) })), total, query),
        summary: {
          startDate: query.startDate ?? null, endDate: query.endDate ?? null,
          transactionCount: total, totalIn: Number(totalIn), totalOut: Number(totalOut),
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
