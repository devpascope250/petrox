import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type { CreateDiscountInput, RangingDiscountInput, UpdateDiscountInput } from "./discount.schema.js";

const discountSelect = {
  id: true,
  type: true,
  value: true,
  status: true,
  clientId: true,
  client: { select: { id: true, clientCode: true, name: true } },
  siteId: true,
  site: { select: { id: true, name: true } },
  validFrom: true,
  validTo: true,
  createdBy: true,
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdAt: true,
  rangingDiscounts: {
    orderBy: [{ siteId: "asc" }, { from: "asc" }],
    select: { id: true, from: true, to: true, rate: true, siteId: true, status: true, createdAt: true,
      site: { select: { id: true, name: true } } }
  }
} satisfies Prisma.DiscountSelect;

const rangeData = (range: RangingDiscountInput) => ({
  from: new Prisma.Decimal(range.from),
  to: new Prisma.Decimal(range.to),
  rate: new Prisma.Decimal(range.rate),
  siteId: range.siteId,
  status: range.status
});

export class DiscountRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery, clientId?: string) {
    const where: Prisma.DiscountWhereInput = clientId ? { clientId } : {};
    return this.db.$transaction([
      this.db.discount.findMany({ ...paginationArgs(query), where, orderBy: { createdAt: "desc" }, select: discountSelect }),
      this.db.discount.count({ where })
    ]);
  }

  find(id: string, clientId?: string) {
    return this.db.discount.findFirst({ where: { id, ...(clientId ? { clientId } : {}) }, select: discountSelect });
  }

  findClient(id: string) { return this.db.client.findUnique({ where: { id }, select: { id: true } }); }
  findSites(ids: string[]) { return this.db.tblSite.findMany({ where: { id: { in: ids } }, select: { id: true } }); }

  create(input: CreateDiscountInput, createdBy: string) {
    return this.db.discount.create({
      data: {
        type: input.type,
        value: new Prisma.Decimal(input.value),
        status: input.status,
        clientId: input.type === "fixed" ? input.clientId : null,
        siteId: input.siteId,
        validFrom: input.validFrom,
        validTo: input.validTo,
        createdBy,
        ...(input.type === "ranging" ? { rangingDiscounts: { create: input.rangingDiscounts.map(rangeData) } } : {})
      },
      select: discountSelect
    });
  }

  update(id: string, input: UpdateDiscountInput) {
    return this.db.$transaction(async (tx) => {
      await tx.rangingDiscount.deleteMany({ where: { discountId: id } });
      return tx.discount.update({
        where: { id },
        data: {
          type: input.type,
          value: new Prisma.Decimal(input.value),
          status: input.status,
          clientId: input.type === "fixed" ? input.clientId : null,
          siteId: input.siteId ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo,
          ...(input.type === "ranging" ? { rangingDiscounts: { create: input.rangingDiscounts.map(rangeData) } } : {})
        },
        select: discountSelect
      });
    });
  }

  changeStatus(id: string, status: "active" | "inactive") {
    return this.db.$transaction(async (tx) => {
      await tx.rangingDiscount.updateMany({ where: { discountId: id }, data: { status } });
      return tx.discount.update({ where: { id }, data: { status }, select: discountSelect });
    });
  }

  delete(id: string) {
    return this.db.$transaction(async (tx) => {
      await tx.rangingDiscount.deleteMany({ where: { discountId: id } });
      return tx.discount.delete({ where: { id }, select: discountSelect });
    });
  }
}
