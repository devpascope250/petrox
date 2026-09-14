import type { AppConfig } from "../../config/env.js";
import { AuthUser } from "../../shared/auth/context-user.js";
import { CuveRepository } from "./cuve.repository.js";
import { CreateCuveSchema, CuveStockQuery, CuveTransactionsQuery } from "./cuve.schema.js";
import { AppError, forbidden } from "../../utils/errors.js";
export class CuveService {
  constructor(private repo: CuveRepository, private config: AppConfig) {}

  async list(actor: AuthUser) {
    return await this.repo.list(actor);
  }

  find(id: string) { return this.repo.find(id); }

  stocks(query: CuveStockQuery, actor: AuthUser) {
    const siteId = this.stockSite(actor) ?? query.siteId;
    if (!siteId) throw new AppError(400, "SITE_ID_REQUIRED", "Select a site to view current stock");
    return this.repo.stocks({ siteId });
  }

  transactions(id: string, query: CuveTransactionsQuery, actor: AuthUser) {
    return this.repo.transactions(id, query, this.stockSite(actor));
  }

  private stockSite(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (actor.position !== "siteManager" || !actor.siteId) {
      throw forbidden("Stock reports require a super administrator or a site manager assigned to a site");
    }
    return actor.siteId;
  }

  async create(input: CreateCuveSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateCuveSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}
