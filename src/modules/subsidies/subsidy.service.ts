import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { presentSubsidy, SubsidyRepository } from "./subsidy.repository.js";
import type { ActiveSubsidyQuery, CreateSubsidyInput, SubsidyListQuery, UpdateSubsidyInput } from "./subsidy.schema.js";

/**
 * What the state pays towards a litre of a product.
 *
 * A product has **at most one active subsidy at a time**, so recording or
 * switching one on retires the one it replaces; the repository does that in
 * the same transaction as the write. The answer carries `replaced`: how many
 * were retired, so a screen can say so rather than leave it a surprise.
 */
export class SubsidyService {
  constructor(private repo: SubsidyRepository) {}

  async list(query: SubsidyListQuery, actor: AuthUser) {
    const [items, total] = await this.repo.list(query, this.scope(actor));
    return paginatedData(items.map(presentSubsidy), total, query);
  }

  async find(id: string, actor: AuthUser) {
    const subsidy = await this.repo.find(id, this.scope(actor));
    if (!subsidy) throw new NotFoundError("Subsidy");
    return subsidy;
  }

  /** The subsidy in force for a product right now; `null` when there is none. */
  active(query: ActiveSubsidyQuery, actor: AuthUser) {
    const siteId = this.scope(actor) ?? query.siteId;
    return this.repo.active({ ...query, siteId });
  }

  async create(input: CreateSubsidyInput, actor: AuthUser) {
    await this.validate(input, actor);
    return this.repo.create(input, actor.userId);
  }

  async update(id: string, input: UpdateSubsidyInput, actor: AuthUser) {
    await this.find(id, actor);
    await this.validate(input, actor);
    return this.repo.update(id, input);
  }

  /** Switches a subsidy on or off; switching one on retires the product's current one. */
  async changeStatus(id: string, actor: AuthUser) {
    const subsidy = await this.find(id, actor);
    return this.repo.changeStatus(id, subsidy.itemId, subsidy.status === "active" ? "inactive" : "active");
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return this.repo.delete(id);
  }

  private async validate(input: CreateSubsidyInput | UpdateSubsidyInput, actor: AuthUser) {
    const item = await this.repo.findItem(input.itemId);
    if (!item) throw new NotFoundError("Item");
    if (item.status !== "active") {
      throw new BusinessError("ITEM_INACTIVE", `${item.name} is not active, so it cannot be subsidised`);
    }
    const own = this.scope(actor);
    if (own && input.siteId && input.siteId !== own) {
      throw forbidden("You can only manage subsidies for your own site");
    }
    if (input.siteId) {
      const site = await this.repo.findSite(input.siteId);
      if (!site) throw new NotFoundError("Site");
    }
  }

  /** No site for a super administrator, their own for site staff. */
  private scope(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (!isSiteBound(actor) || !actor.siteId) {
      throw forbidden("Subsidies require a super administrator or site staff assigned to a site");
    }
    return actor.siteId;
  }
}
