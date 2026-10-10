import { PrismaClient, Prisma } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs, paginatedData } from "../../shared/pagination/index.js";
import type { CreateClientCouponInput, UpdateClientCouponInput, ClientCouponQuery, ClientCouponClientQuery } from "./client-coupon.schema.js";

const include = { couponPlan: true, client: true } as const;
export class ClientCouponRepository {
  constructor(private db: PrismaClient) {}
  async list(query: ClientCouponQuery) {
    const { clientId, couponPlanId, status, code, export: exported } = query;
    const where: Prisma.ClientCouponWhereInput = { clientId, couponPlanId, status, code, export: exported };
    const [items, total] = await this.db.$transaction([
      this.db.clientCoupon.findMany({ where, ...paginationArgs(query), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include }),
      this.db.clientCoupon.count({ where }),
    ]);
    return paginatedData(items, total, query);
  }
  /**
   * The clients holding coupons, one row each: how many coupons they hold in
   * each status, what those are worth, and when they last bought one.
   */
  async listByClient(query: ClientCouponClientQuery) {
    const where: Prisma.ClientWhereInput = {
      clientCoupons: { some: {} },
      ...(query.search ? {
        OR: [
          { name: { contains: query.search } },
          { email: { contains: query.search } },
          { clientCode: { contains: query.search } },
        ],
      } : {}),
    };
    const [clients, total] = await this.db.$transaction([
      this.db.client.findMany({
        where, ...paginationArgs(query), orderBy: [{ name: "asc" }, { clientCode: "asc" }],
        select: { id: true, clientCode: true, name: true, email: true, phone: true },
      }),
      this.db.client.count({ where }),
    ]);
    const groups = clients.length === 0 ? [] : await this.db.clientCoupon.groupBy({
      by: ["clientId", "status"],
      where: { clientId: { in: clients.map((client) => client.id) } },
      orderBy: [{ clientId: "asc" }, { status: "asc" }],
      _count: { _all: true },
      _sum: { amount: true },
      _max: { createdAt: true },
    });
    const items = clients.map((client) => {
      const own = groups.filter((group) => group.clientId === client.id);
      const statusCounts = Object.fromEntries(own.map((group) => [group.status, group._count._all]));
      const totalAmount = own.reduce((sum, group) => sum.add(group._sum.amount ?? 0), new Prisma.Decimal(0));
      const lastBoughtAt = own.reduce<Date | null>((latest, group) =>
        group._max.createdAt && (!latest || group._max.createdAt > latest) ? group._max.createdAt : latest, null);
      return {
        ...client,
        totalCoupons: own.reduce((sum, group) => sum + group._count._all, 0),
        totalAmount: totalAmount.toFixed(2),
        statusCounts,
        lastBoughtAt,
      };
    });
    return paginatedData(items, total, query);
  }
  /**
   * Everything one client has bought, summed: in total, per status and per
   * plan — each with how many coupons and what they are worth.
   */
  async clientSummary(clientId: string) {
    const groups = await this.db.clientCoupon.groupBy({
      by: ["couponPlanId", "status"],
      where: { clientId },
      orderBy: [{ couponPlanId: "asc" }, { status: "asc" }],
      _count: { _all: true },
      _sum: { amount: true },
      _max: { createdAt: true },
    });
    const plans = groups.length === 0 ? [] : await this.db.couponPlan.findMany({
      where: { id: { in: [...new Set(groups.map((group) => group.couponPlanId))] } },
      select: { id: true, name: true, amount: true },
    });
    const zero = () => ({ count: 0, amount: new Prisma.Decimal(0) });
    const add = (into: { count: number; amount: Prisma.Decimal }, group: (typeof groups)[number]) => {
      into.count += group._count._all;
      into.amount = into.amount.add(group._sum.amount ?? 0);
    };
    const total = zero();
    const byStatus = new Map<string, ReturnType<typeof zero>>();
    const byPlan = new Map<string, ReturnType<typeof zero>>();
    let lastBoughtAt: Date | null = null;
    for (const group of groups) {
      add(total, group);
      add(byStatus.get(group.status) ?? byStatus.set(group.status, zero()).get(group.status)!, group);
      add(byPlan.get(group.couponPlanId) ?? byPlan.set(group.couponPlanId, zero()).get(group.couponPlanId)!, group);
      if (group._max.createdAt && (!lastBoughtAt || group._max.createdAt > lastBoughtAt)) lastBoughtAt = group._max.createdAt;
    }
    const plan = new Map(plans.map((row) => [row.id, row]));
    return {
      totalCoupons: total.count,
      totalAmount: total.amount.toFixed(2),
      lastBoughtAt,
      byStatus: [...byStatus].map(([status, sum]) => ({ status, count: sum.count, amount: sum.amount.toFixed(2) })),
      byPlan: [...byPlan]
        .map(([couponPlanId, sum]) => ({
          couponPlanId,
          name: plan.get(couponPlanId)?.name ?? "Deleted plan",
          price: plan.get(couponPlanId)?.amount.toFixed(2) ?? null,
          count: sum.count,
          amount: sum.amount.toFixed(2),
        }))
        .sort((a, b) => b.count - a.count),
    };
  }
  find(id: string) { return this.db.clientCoupon.findUnique({ where: { id }, include }); }
  create(data: CreateClientCouponInput & { code: string; token: string, amount: string }) { return this.db.clientCoupon.create({ data: {... data, amount: Prisma.Decimal(data.amount)}, include }); }
  update(id: string, data: UpdateClientCouponInput) { return this.db.clientCoupon.update({ where: { id }, data, include }); }
  delete(id: string) { return this.db.clientCoupon.delete({ where: { id } }); }
  findClient(id: string) { return this.db.client.findUnique({ where: { id }, select: { id: true } }); }
  findPlan(id: string) { return this.db.couponPlan.findUnique({ where: { id }, select: { id: true, amount: true } }); }
}
