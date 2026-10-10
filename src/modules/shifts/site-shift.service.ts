import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { SiteShiftRepository } from "./site-shift.repository.js";
import { CreateSiteShiftSchema, SiteShiftQuerySchema } from "./site-shift.schema.js";
import { assertSiteAccess, siteScope } from "./shift-scope.js";

export class SiteShiftService {
  constructor(private repo: SiteShiftRepository, private config: AppConfig) {}

  /** A site manager always sees his own site; anyone else may filter by one. */
  async list(query: SiteShiftQuerySchema, actor: AuthUser) {
    return await this.repo.list(siteScope(actor) ?? query.siteId);
  }

  async find(id: string, actor: AuthUser) {
    const row = await this.repo.find(id);
    if (!row) throw new NotFoundError("Site shift");
    assertSiteAccess(row.siteId, actor);
    return row;
  }

  async create(input: CreateSiteShiftSchema, actor: AuthUser) {
    assertSiteAccess(input.siteId, actor);
    await this.validate(input);
    return this.repo.create(input);
  }

  async update(id: string, input: CreateSiteShiftSchema, actor: AuthUser) {
    // Both the site it is on now and the site it would move to must be his.
    await this.find(id, actor);
    assertSiteAccess(input.siteId, actor);
    await this.validate(input, id);
    return await this.repo.update(id, input);
  }

  async updateStatus(id: string, actor: AuthUser) {
    await this.find(id, actor);
    return await this.repo.changeStatus(id);
  }

  private async validate(input: CreateSiteShiftSchema, excludeId?: string) {
    const shift = await this.repo.findShift(input.shiftId);
    if (!shift) throw new NotFoundError("Shift");
    if (!shift.status) {
      throw new BusinessError("SHIFT_INACTIVE", `The shift "${shift.name}" is switched off`);
    }
    if (!(await this.repo.findSite(input.siteId))) throw new NotFoundError("Site");
    if (await this.repo.findDuplicate(input.shiftId, input.siteId, excludeId)) {
      throw new ConflictError("SITE_SHIFT_EXISTS", `The "${shift.name}" shift is already set up at this site`);
    }
  }
}
