import type { AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError, forbidden } from "../../utils/errors.js";
import { DiscountRepository } from "./discount.repository.js";
import type { CreateDiscountInput, UpdateDiscountInput } from "./discount.schema.js";

export class DiscountService {
  constructor(private repo: DiscountRepository) {}

  async list(query: PaginationQuery, actor: AuthUser) {
    const [items, total] = await this.repo.list(query, this.clientScope(actor));
    return paginatedData(items, total, query);
  }

  async find(id: string, actor: AuthUser) {
    const discount = await this.repo.find(id, this.clientScope(actor));
    if (!discount) throw new NotFoundError("Discount");
    return discount;
  }

  async create(input: CreateDiscountInput, actor: AuthUser) {
    await this.validateReferences(input, actor);
    return this.repo.create(input, actor.userId);
  }

  async update(id: string, input: UpdateDiscountInput, actor: AuthUser) {
    await this.find(id, actor);
    await this.validateReferences(input, actor);
    return this.repo.update(id, input);
  }

  async changeStatus(id: string, actor: AuthUser) {
    const discount = await this.find(id, actor);
    return this.repo.changeStatus(id, discount.status === "active" ? "inactive" : "active");
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return this.repo.delete(id);
  }

  private async validateReferences(input: CreateDiscountInput | UpdateDiscountInput, actor: AuthUser) {
    if (input.type === "fixed") {
      this.assertClientAccess(input.clientId, actor);
      if (!(await this.repo.findClient(input.clientId))) throw new NotFoundError("Client");
    } else if (actor.position === "clientAdmin" || actor.position === "clientUser") {
      throw forbidden("Client users cannot manage ranging discounts");
    }

    const siteIds = [...new Set([
      ...(input.siteId ? [input.siteId] : []),
      ...(input.type === "ranging" ? input.rangingDiscounts.map((range) => range.siteId) : [])
    ])];
    if (actor.position === "siteManager" && siteIds.some((id) => id !== actor.siteId)) {
      throw forbidden("You can only manage discounts for your own site");
    }
    if (siteIds.length && (await this.repo.findSites(siteIds)).length !== siteIds.length) {
      throw new NotFoundError("Site");
    }
  }

  private clientScope(actor: AuthUser) {
    if (actor.position === "superAdmin" || actor.position === "siteManager") return undefined;
    if (!actor.clientId) throw forbidden("Your user account is not assigned to a client");
    return actor.clientId;
  }

  private assertClientAccess(clientId: string, actor: AuthUser) {
    const scope = this.clientScope(actor);
    if (scope && scope !== clientId) throw forbidden("You can only manage discounts for your own client");
  }
}
