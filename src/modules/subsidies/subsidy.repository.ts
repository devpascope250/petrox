import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { fromDate, toDate } from "../shifts/shift-scope.js";
import type { ActiveSubsidyQuery, CreateSubsidyInput, SubsidyListQuery, UpdateSubsidyInput } from "./subsidy.schema.js";

type Tx = Prisma.TransactionClient;

const subsidySelect = {
  id: true,
  itemId: true,
  item: { select: { id: true, name: true, baseUnit: { select: { id: true, name: true, code: true } } } },
  siteId: true,
  site: { select: { id: true, name: true } },
  rate: true,
  from: true,
  to: true,
  status: true,
  note: true,
  createdBy: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdAt: true,
  updated: true,
} satisfies Prisma.SubsidySelect;

type SubsidyRow = Prisma.SubsidyGetPayload<{ select: typeof subsidySelect }>;

/**
 * A subsidy as the screens read it: the rate as a number, and `from`/`to` as
 * the calendar days they are stored as, without shifting them into the
 * server's timezone.
 */
export function presentSubsidy(subsidy: SubsidyRow) {
  return {
    ...subsidy,
    rate: Number(subsidy.rate),
    from: fromDate(subsidy.from),
    to: fromDate(subsidy.to),
  };
}

const data = (input: CreateSubsidyInput | UpdateSubsidyInput) => ({
  itemId: input.itemId,
  siteId: input.siteId ?? null,
  rate: new Prisma.Decimal(input.rate),
  from: toDate(input.from),
  to: toDate(input.to),
  status: input.status,
  note: input.note || null,
});

/**
 * Retires whatever subsidy is active on a product, except the row named.
 *
 * **A product has at most one active subsidy at a time**: a second one would
 * leave the pump with two rates and no rule for choosing between them. MySQL
 * has no partial unique index, so the invariant cannot be a constraint; it is
 * kept here instead, and every write that leaves a row active runs this in
 * the same transaction, so two administrators activating a subsidy on the
 * same product at once still end with one active.
 *
 * Returns how many were retired, so the answer can say what it replaced.
 */
async function retireActive(tx: Tx, itemId: string, except?: string) {
  const retired = await tx.subsidy.updateMany({
    where: { itemId, status: "active", ...(except ? { id: { not: except } } : {}) },
    data: { status: "inactive" },
  });
  return retired.count;
}

export class SubsidyRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Subsidies newest first. Dates match a subsidy whose period **overlaps**
   * the window asked for: one that started before it and still runs is in
   * force inside it.
   */
  private where(query: SubsidyListQuery, siteId?: string): Prisma.SubsidyWhereInput {
    return {
      itemId: query.itemId,
      // A site-bound user sees their own site's subsidies and the company-wide
      // ones, which apply at their site too.
      ...(siteId
        ? { OR: [{ siteId }, { siteId: null }] }
        : query.siteId
          ? { siteId: query.siteId === "none" ? null : query.siteId }
          : {}),
      status: query.status,
      ...(query.endDate ? { from: { lte: query.endDate } } : {}),
      ...(query.startDate ? { to: { gte: query.startDate } } : {}),
    };
  }

  list(query: SubsidyListQuery, siteId?: string) {
    const where = this.where(query, siteId);
    return this.db.$transaction([
      this.db.subsidy.findMany({
        ...paginationArgs(query), where, select: subsidySelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.db.subsidy.count({ where }),
    ]);
  }

  async find(id: string, siteId?: string) {
    const subsidy = await this.db.subsidy.findFirst({
      where: { id, ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : {}) },
      select: subsidySelect,
    });
    return subsidy && presentSubsidy(subsidy);
  }

  findItem(id: string) { return this.db.item.findUnique({ where: { id }, select: { id: true, name: true, status: true } }); }
  findSite(id: string) { return this.db.tblSite.findUnique({ where: { id }, select: { id: true, status: true } }); }

  /**
   * The subsidy in force for a product right now: active, and today inside
   * its period. The site's own comes before the company-wide one, so a site
   * with its own rate is not given the national one.
   */
  async active(query: ActiveSubsidyQuery, today = new Date()) {
    const day = toDate(fromDate(today));
    const subsidy = await this.db.subsidy.findFirst({
      where: {
        itemId: query.itemId, status: "active", from: { lte: day }, to: { gte: day },
        ...(query.siteId ? { OR: [{ siteId: query.siteId }, { siteId: null }] } : {}),
      },
      orderBy: [{ siteId: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      select: subsidySelect,
    });
    return subsidy && presentSubsidy(subsidy);
  }

  /** Records a subsidy, retiring the product's active one when this one is active. */
  create(input: CreateSubsidyInput, createdBy: string) {
    return this.db.$transaction(async (tx) => {
      const replaced = input.status === "active" ? await retireActive(tx, input.itemId) : 0;
      const subsidy = await tx.subsidy.create({ data: { ...data(input), createdBy }, select: subsidySelect });
      return { ...presentSubsidy(subsidy), replaced };
    });
  }

  /**
   * Changes a subsidy. When it is left active, the product's other active one
   * is retired — including on the product it is being **moved to**, since the
   * item can change here.
   */
  update(id: string, input: UpdateSubsidyInput) {
    return this.db.$transaction(async (tx) => {
      const replaced = input.status === "active" ? await retireActive(tx, input.itemId, id) : 0;
      const subsidy = await tx.subsidy.update({ where: { id }, data: data(input), select: subsidySelect });
      return { ...presentSubsidy(subsidy), replaced };
    });
  }

  /**
   * Turns a subsidy on or off. Turning one on retires the product's current
   * active one, which is the whole point of the switch: it is how a new rate
   * takes over from the old one.
   */
  changeStatus(id: string, itemId: string, status: "active" | "inactive") {
    return this.db.$transaction(async (tx) => {
      const replaced = status === "active" ? await retireActive(tx, itemId, id) : 0;
      const subsidy = await tx.subsidy.update({ where: { id }, data: { status }, select: subsidySelect });
      return { ...presentSubsidy(subsidy), replaced };
    });
  }

  async delete(id: string) {
    const subsidy = await this.db.subsidy.delete({ where: { id }, select: subsidySelect });
    return presentSubsidy(subsidy);
  }
}
