import type { PrismaClient, Prisma } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs, paginatedData } from "../../shared/pagination/index.js";
import type { CreateCouponPlanInput, UpdateCouponPlanInput, CouponPlanQuery } from "./coupon-plan.schema.js";

const include = { _count: { select: { clientCoupons: true } } } as const;
export class CouponPlanRepository {
  constructor(private db: PrismaClient) {}
  async list(query: CouponPlanQuery) {
    const { search, status } = query;
    const where: Prisma.CouponPlanWhereInput = { status, ...(search ? { name: { contains: search } } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.couponPlan.findMany({ where, ...paginationArgs(query), orderBy: [{ createdAt: "desc" }, { id: "desc" }], include }),
      this.db.couponPlan.count({ where }),
    ]);
    return paginatedData(items, total, query);
  }
  find(id: string) { return this.db.couponPlan.findUnique({ where: { id }, include }); }
  create(data: CreateCouponPlanInput) { return this.db.couponPlan.create({ data, include }); }
  update(id: string, data: UpdateCouponPlanInput) { return this.db.couponPlan.update({ where: { id }, data, include }); }
  delete(id: string) { return this.db.couponPlan.delete({ where: { id } }); }
  countCoupons(id: string) { return this.db.clientCoupon.count({ where: { couponPlanId: id } }); }
}
