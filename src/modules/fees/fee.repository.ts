import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import type { AssignFeesSchema, CreateFeeTypeSchema, FeeTypeListQuery } from "./fee.schema.js";

const feeTypeSelect = {
  id: true,
  name: true,
  amount: true,
  currencyCode: true,
  status: true,
  createdAt: true,
  /** How many charges refer to it — an answer to "may I retire this fee?". */
  _count: { select: { chainStockFees: true, pfiFees: true } },
} satisfies Prisma.FeeTypeSelect;

/** What a charge shows: its own figures, not the catalogue's current ones. */
const feeSelect = {
  id: true,
  feeTypeId: true,
  name: true,
  count: true,
  unitAmount: true,
  currencyCode: true,
  createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * What a report selects to carry a central stock receipt's landing fees.
 *
 * Shared so every report shows the same thing, and `satisfies` so dropping a
 * column from the model is a compile error rather than a 500 at report time.
 */
export const reportFeeSelect = {
  orderBy: { name: "asc" },
  select: {
    id: true, feeTypeId: true, name: true, count: true,
    unitAmount: true, currencyCode: true, createdAt: true,
  },
} satisfies Prisma.CentralStock$chainStockFeesArgs;

type ReportFeeRow = {
  id: string; feeTypeId: string; name: string; count: number;
  unitAmount: Prisma.Decimal; currencyCode: string; createdAt: Date;
};

/**
 * A receipt's landing fees as every report shows them: each charge with what
 * its line comes to, and the totals **grouped by currency**.
 *
 * `fees` is an empty list and `feeTotals` an empty object when nothing was
 * charged, so a report row has the same shape whether or not fees were
 * provided — a reader never has to test for a missing field.
 */
export function presentFees(fees: ReportFeeRow[]) {
  const { byCurrency, feeCount } = totalsOf(fees);
  return {
    fees: fees.map((fee) => ({
      ...fee,
      unitAmount: Number(fee.unitAmount),
      lineTotal: Number(fee.unitAmount.times(fee.count).toFixed(2)),
    })),
    feeTotals: byCurrency,
    feeCount,
  };
}

/**
 * The landing fees of many receipts added up, grouped by currency — for a
 * summary line over a page or a period.
 */
export function sumFeeTotals(groups: Array<Record<string, number>>) {
  const byCurrency: Record<string, number> = {};
  for (const group of groups) {
    for (const [currency, amount] of Object.entries(group)) {
      byCurrency[currency] = Number(
        new Prisma.Decimal(byCurrency[currency] ?? 0).plus(amount).toFixed(2),
      );
    }
  }
  return byCurrency;
}

export class FeeRepository {
  constructor(private db: PrismaClient) {}

  /* ---- the catalogue ---------------------------------------------------- */

  async listTypes(query: FeeTypeListQuery) {
    const { startDate, endDate, status, search } = query;
    const where: Prisma.FeeTypeWhereInput = {
      ...(startDate || endDate
        ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
      ...(status ? { status } : {}),
      ...(search ? { name: { contains: search } } : {}),
    };
    return this.db.$transaction([
      this.db.feeType.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: feeTypeSelect,
      }),
      this.db.feeType.count({ where }),
    ]);
  }

  /** Every fee that may still be charged, for the form's picker. */
  activeTypes() {
    return this.db.feeType.findMany({
      where: { status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, amount: true, currencyCode: true },
    });
  }

  findType(id: string) {
    return this.db.feeType.findUnique({ where: { id }, select: feeTypeSelect });
  }

  createType(data: CreateFeeTypeSchema) {
    return this.db.feeType.create({
      data: {
        name: data.name,
        amount: data.amount,
        currencyCode: data.currencyCode,
        status: data.status ?? "active",
      },
      select: feeTypeSelect,
    });
  }

  async updateType(id: string, data: CreateFeeTypeSchema) {
    if (!(await this.findType(id))) throw new NotFoundError("Fee type");
    /*
     * Editing the price changes what the next charge will cost, and nothing
     * already charged: every charge keeps its own copy. That is the whole point
     * of the copies, and why this needs no warning.
     */
    return this.db.feeType.update({
      where: { id },
      data: {
        name: data.name,
        amount: data.amount,
        currencyCode: data.currencyCode,
        ...(data.status ? { status: data.status } : {}),
      },
      select: feeTypeSelect,
    });
  }

  async changeTypeStatus(id: string) {
    const type = await this.findType(id);
    if (!type) throw new NotFoundError("Fee type");
    return this.db.feeType.update({
      where: { id },
      data: { status: type.status === "active" ? "inactive" : "active" },
      select: feeTypeSelect,
    });
  }

  /* ---- charging them --------------------------------------------------- */

  /**
   * Replaces the fees charged against one record with the set given.
   *
   * Sent as a whole set rather than one call per fee, so the result does not
   * depend on the order the calls arrive in, and so removing a fee needs no
   * separate endpoint. Each row copies the catalogue's name, amount and
   * currency as they are now — a total worked out today must not move when a
   * price is edited tomorrow.
   */
  assign(
    target: { centralStockId: string } | { pfiId: string },
    input: AssignFeesSchema,
    userId: string | null,
  ) {
    const isCentralStock = "centralStockId" in target;
    return this.db.$transaction(async (tx) => {
      if (isCentralStock) {
        if (!(await tx.centralStock.findUnique({ where: { id: target.centralStockId }, select: { id: true } }))) {
          throw new NotFoundError("Central stock");
        }
      } else if (!(await tx.pfi.findUnique({ where: { id: target.pfiId }, select: { id: true } }))) {
        throw new NotFoundError("PFI");
      }

      const ids = input.fees.map((fee) => fee.feeTypeId);
      if (new Set(ids).size !== ids.length) {
        throw new BusinessError("DUPLICATE_FEE", "Each fee can only be charged once; use its count instead");
      }
      const types = await tx.feeType.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, amount: true, currencyCode: true, status: true },
      });
      const byId = new Map(types.map((type) => [type.id, type]));
      for (const fee of input.fees) {
        const type = byId.get(fee.feeTypeId);
        if (!type) throw new NotFoundError("Fee type");
        if (type.status !== "active") {
          throw new BusinessError("FEE_INACTIVE", `"${type.name}" is no longer charged`);
        }
      }

      // Replaced as a set: what is sent is what is charged afterwards.
      if (isCentralStock) {
        await tx.chainStockFee.deleteMany({ where: { centralStockId: target.centralStockId } });
        if (input.fees.length) {
          await tx.chainStockFee.createMany({
            data: input.fees.map((fee) => {
              const type = byId.get(fee.feeTypeId)!;
              return {
                centralStockId: target.centralStockId,
                feeTypeId: type.id,
                count: fee.count,
                name: type.name,
                unitAmount: type.amount,
                currencyCode: type.currencyCode,
                createdBy: userId,
              };
            }),
          });
        }
        return this.forCentralStock(target.centralStockId, tx);
      }

      await tx.pfiFee.deleteMany({ where: { pfiId: target.pfiId } });
      if (input.fees.length) {
        await tx.pfiFee.createMany({
          data: input.fees.map((fee) => {
            const type = byId.get(fee.feeTypeId)!;
            return {
              pfiId: target.pfiId,
              feeTypeId: type.id,
              count: fee.count,
              name: type.name,
              unitAmount: type.amount,
              currencyCode: type.currencyCode,
              createdBy: userId,
            };
          }),
        });
      }
      return this.forPfi(target.pfiId, tx);
    });
  }

  /** The fees on one central stock receipt, with what they come to. */
  async forCentralStock(centralStockId: string, tx: Prisma.TransactionClient | PrismaClient = this.db) {
    const fees = await tx.chainStockFee.findMany({
      where: { centralStockId },
      orderBy: { name: "asc" },
      select: feeSelect,
    });
    return { fees, totals: totalsOf(fees) };
  }

  /** The fees on one proforma, with what they come to. */
  async forPfi(pfiId: string, tx: Prisma.TransactionClient | PrismaClient = this.db) {
    const fees = await tx.pfiFee.findMany({
      where: { pfiId },
      orderBy: { name: "asc" },
      select: feeSelect,
    });
    return { fees, totals: totalsOf(fees) };
  }
}

/**
 * What a set of charges comes to, **grouped by currency**. Fees are not always
 * in the money of the invoice they sit beside, and adding two currencies
 * together would be a wrong number rather than a rounded one.
 */
export function totalsOf(
  fees: Array<{ count: number; unitAmount: Prisma.Decimal; currencyCode: string }>,
) {
  const byCurrency: Record<string, number> = {};
  for (const fee of fees) {
    const line = fee.unitAmount.times(fee.count);
    byCurrency[fee.currencyCode] = Number(
      new Prisma.Decimal(byCurrency[fee.currencyCode] ?? 0).plus(line).toFixed(2),
    );
  }
  return { byCurrency, feeCount: fees.length };
}
