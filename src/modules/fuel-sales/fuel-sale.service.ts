import { AuthUser, isSiteBound } from "../../shared/auth/context-user.js";
import { AppError, forbidden } from "../../utils/errors.js";
import { FuelSaleRepository } from "./fuel-sale.repository.js";
import type { CreateFuelSale, FuelSaleListQuery, FuelSaleQuoteQuery, FuelSaleReportQuery } from "./fuel-sale.schema.js";

export class FuelSaleService {
  constructor(private repo: FuelSaleRepository) {}

  options(siteId: string | undefined, actor: AuthUser) {
    return this.repo.options(this.site(actor, siteId));
  }

  /** What a sale would come to, discount included, before it is recorded. */
  quote(query: FuelSaleQuoteQuery, actor: AuthUser) {
    return this.repo.quote(this.site(actor, query.siteId), query);
  }

  list(query: FuelSaleListQuery, actor: AuthUser) {
    return this.repo.list(this.site(actor, query.siteId), query);
  }

  find(id: string, actor: AuthUser) {
    return this.repo.find(id, this.scope(actor));
  }

  /** Site staff sell from their own site's nozzles only; a super administrator from any. */
  record(input: CreateFuelSale, actor: AuthUser) {
    return this.repo.record(input, actor.userId, this.scope(actor));
  }

  report(query: FuelSaleReportQuery, actor: AuthUser) {
    return this.repo.report(this.site(actor, query.siteId), query);
  }

  /** The site someone is held to: none for a super administrator, their own for site staff. */
  private scope(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (!isSiteBound(actor) || !actor.siteId) {
      throw forbidden("Fuel sales require a super administrator or site staff assigned to a site");
    }
    return actor.siteId;
  }

  /** Site staff always get their own site, whatever is asked for; a super administrator must name one. */
  private site(actor: AuthUser, requested?: string) {
    const siteId = this.scope(actor) ?? requested;
    if (!siteId) throw new AppError(400, "SITE_ID_REQUIRED", "Select a site");
    return siteId;
  }
}
