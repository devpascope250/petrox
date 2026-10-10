import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { CouponSaleClientQuery } from "./coupon-sale.schema.js";

export class CouponSaleRepository {
  constructor(private db: PrismaClient) {}

  /** Clients matched by name, email or code, each with the wallets they pay from. */
  async searchClients(query: CouponSaleClientQuery, clientId?: string) {
    const scope: Prisma.ClientWhereInput = clientId ? { id: clientId } : {};
    const where: Prisma.ClientWhereInput = {
      AND: [scope, {
        OR: [
          { name: { contains: query.search } },
          { email: { contains: query.search } },
          { clientCode: { contains: query.search } }
        ]
      }]
    };
    return this.db.$transaction([
      this.db.client.findMany({
        ...paginationArgs(query),
        where,
        orderBy: { name: "asc" },
        select: {
          id: true, clientCode: true, name: true, email: true, phone: true, status: true,
          clientWallets: {
            orderBy: [{ status: "asc" }, { createdAt: "asc" }],
            select: { id: true, amount: true, status: true }
          }
        }
      }),
      this.db.client.count({ where })
    ]);
  }

  /** Active plans, with how many coupons each has already issued. */
  listActivePlans() {
    return this.db.couponPlan.findMany({
      where: { status: "active" },
      orderBy: [{ amount: "asc" }, { name: "asc" }],
      select: { id: true, name: true, number: true, amount: true, _count: { select: { clientCoupons: true } } }
    });
  }
}
