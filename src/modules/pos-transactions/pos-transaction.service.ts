import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { forbidden } from "../../utils/errors.js";
import { PosTransactionRepository } from "./pos-transaction.repository.js";
import type { PosTransactionListQuery, PosTransactionReportQuery } from "./pos-transaction.schema.js";

export class PosTransactionService {
  constructor(private repo: PosTransactionRepository) {}

  /** A super administrator sees every site, or narrows to one; site staff always get their own. */
  list(query: PosTransactionListQuery, actor: AuthUser) {
    return this.repo.list(this.scope(actor) ?? query.siteId, query);
  }

  /** The financial report over everything the same filters match. */
  report(query: PosTransactionReportQuery, actor: AuthUser) {
    return this.repo.report(this.scope(actor) ?? query.siteId, query);
  }

  find(id: string, actor: AuthUser) {
    return this.repo.find(id, this.scope(actor));
  }

  /** The site someone is held to: none for a super administrator, their own for site staff. */
  private scope(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (!isSiteBound(actor) || !actor.siteId) {
      throw forbidden("POS transactions require a super administrator or site staff assigned to a site");
    }
    return actor.siteId;
  }
}
