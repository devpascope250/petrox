import { PrismaClient, Prisma } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs, paginatedData } from "../../shared/pagination/index.js";
import type { CreateClientCouponInput, UpdateClientCouponInput, ClientCouponQuery } from "./client-coupon.schema.js";

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
  find(id: string) { return this.db.clientCoupon.findUnique({ where: { id }, include }); }
  create(data: CreateClientCouponInput & { code: string; token: string, amount: string }) { return this.db.clientCoupon.create({ data: {... data, amount: Prisma.Decimal(data.amount)}, include }); }
  update(id: string, data: UpdateClientCouponInput) { return this.db.clientCoupon.update({ where: { id }, data, include }); }
  delete(id: string) { return this.db.clientCoupon.delete({ where: { id } }); }
  findClient(id: string) { return this.db.client.findUnique({ where: { id }, select: { id: true } }); }
  findPlan(id: string) { return this.db.couponPlan.findUnique({ where: { id }, select: { id: true, amount: true } }); }
}
