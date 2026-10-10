import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { TimeTableRepository } from "./time-table.repository.js";
import { CopyTimeTableWeekSchema, CreateTimeTableSchema, TimeTableQuerySchema, TimeTableRoleSchema, TimeTableStatusSchema } from "./time-table.schema.js";
import { assertSiteAccess, siteScope } from "./shift-scope.js";

export class TimeTableService {
  constructor(private repo: TimeTableRepository, private config: AppConfig) {}

  /** A site manager always sees his own site; anyone else may filter by one. */
  async list(query: TimeTableQuerySchema, actor: AuthUser) {
    return await this.repo.list({ ...query, siteId: siteScope(actor) ?? query.siteId });
  }

  async find(id: string, actor: AuthUser) {
    const row = await this.repo.find(id);
    if (!row) throw new NotFoundError("Time table entry");
    assertSiteAccess(row.siteId, actor);
    return row;
  }

  async create(input: CreateTimeTableSchema, actor: AuthUser) {
    const siteId = await this.validate(input, actor);
    return this.repo.create(input, siteId);
  }

  async update(id: string, input: CreateTimeTableSchema, actor: AuthUser) {
    await this.find(id, actor);
    const siteId = await this.validate(input, actor, id);
    return await this.repo.update(id, input, siteId);
  }

  /** Marks the day as planned (0), present (1) or absent (2). */
  async updateStatus(id: string, input: TimeTableStatusSchema, actor: AuthUser) {
    await this.find(id, actor);
    return await this.repo.changeStatus(id, input.status);
  }

  /**
   * Makes this person the shift's chief or supporter for that date, or takes
   * the role away. Whoever held the role before loses it; the response names
   * them in `replaced`.
   */
  async updateRole(id: string, input: TimeTableRoleSchema, actor: AuthUser) {
    await this.find(id, actor);
    return await this.repo.setRole(id, input.role);
  }

  /**
   * Copies a week of the roster onto the next one. A site manager copies his
   * own site; anyone else copies the site named, or every site when none is.
   */
  async copyWeek(input: CopyTimeTableWeekSchema, actor: AuthUser) {
    if (input.siteId) assertSiteAccess(input.siteId, actor);
    return await this.repo.copyWeek(input.startDate, siteScope(actor) ?? input.siteId);
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    await this.repo.delete(id);
    return { id };
  }

  /** The person must work at the shift's site. */
  private async validate(input: CreateTimeTableSchema, actor: AuthUser, excludeId?: string) {
    const siteShift = await this.repo.findSiteShift(input.siteShiftId);
    if (!siteShift) throw new NotFoundError("Site shift");
    assertSiteAccess(siteShift.siteId, actor);
    if (siteShift.status !== 1) {
      throw new BusinessError("SITE_SHIFT_INACTIVE", `The "${siteShift.shift.name}" shift is switched off at this site`);
    }
    if (!(await this.repo.findSiteUser(input.userId, siteShift.siteId))) {
      throw new BusinessError("USER_OTHER_SITE", "The person rostered must be an active user assigned to this site");
    }
    if (await this.repo.findDuplicate(input, excludeId)) {
      throw new ConflictError("ALREADY_ROSTERED", "This person is already rostered on that shift that day");
    }
    return siteShift.siteId;
  }
}
