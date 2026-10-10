import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { forbidden } from "../../utils/errors.js";
import type { ClientWalletService } from "../client-wallets/client-wallet.service.js";
import type { CouponSaleRepository } from "./coupon-sale.repository.js";
import type { CouponSaleClientQuery, CouponSaleInput } from "./coupon-sale.schema.js";

/**
 * Selling coupons to a client: find them, see what their wallet holds, and
 * pay for coupons of one or more plans from it. The sale itself is the
 * wallet's coupon purchase, so its balance and plan limits apply unchanged.
 */
export class CouponSaleService {
  constructor(private repo: CouponSaleRepository, private wallets: ClientWalletService) {}

  async searchClients(query: CouponSaleClientQuery, actor: AuthUser) {
    const [items, total] = await this.repo.searchClients(query, this.clientScope(actor));
    return paginatedData(items.map(({ clientWallets, ...client }) => ({
      ...client,
      wallets: clientWallets.map((wallet) => ({ ...wallet, amount: wallet.amount.toFixed(2) }))
    })), total, query);
  }

  /** Plans on sale, each with the coupons it still has to give. */
  async listPlans() {
    const plans = await this.repo.listActivePlans();
    return plans.map(({ _count, ...plan }) => ({
      ...plan,
      amount: plan.amount.toFixed(2),
      issued: _count.clientCoupons,
      remaining: Math.max(plan.number - _count.clientCoupons, 0)
    }));
  }

  sell(input: CouponSaleInput, actor: AuthUser) {
    return this.wallets.buyCoupons(input.walletId, { items: input.items }, actor);
  }

  private clientScope(actor: AuthUser) {
    if (actor.position === "superAdmin" || actor.position === "siteManager") return undefined;
    if (!actor.clientId) throw forbidden("Your user account is not assigned to a client");
    return actor.clientId;
  }
}
