import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { ShiftRepository } from "./shift.repository.js";
import { CreateShiftSchema, ShiftOptionsQuerySchema } from "./shift.schema.js";
import { assertSiteAccess, assertSuperAdmin, siteScope } from "./shift-scope.js";

export class ShiftService {
  constructor(private repo: ShiftRepository, private config: AppConfig) {}

  async list(actor: AuthUser) {
    siteScope(actor);
    return await this.repo.list();
  }

  async find(id: string, actor: AuthUser) {
    siteScope(actor);
    const shift = await this.repo.find(id);
    if (!shift) throw new NotFoundError("Shift");
    return shift;
  }

  async create(input: CreateShiftSchema, actor: AuthUser) {
    assertSuperAdmin(actor);
    await this.assertUniqueName(input.name);
    return this.repo.create(input);
  }

  async update(id: string, input: CreateShiftSchema, actor: AuthUser) {
    assertSuperAdmin(actor);
    await this.assertUniqueName(input.name, id);
    return await this.repo.update(id, input);
  }

  async updateStatus(id: string, actor: AuthUser) {
    assertSuperAdmin(actor);
    return await this.repo.changeStatus(id);
  }

  /**
   * The lists every shift form picks from. A site manager always gets his own
   * site; anyone else names one with `siteId`.
   */
  async options(query: ShiftOptionsQuerySchema, actor: AuthUser) {
    const scoped = siteScope(actor);
    const siteId = scoped ?? query.siteId;
    if (query.siteId) assertSiteAccess(query.siteId, actor);
    return await this.repo.formOptions(siteId, scoped ? { id: scoped } : {});
  }

  private async assertUniqueName(name: string, excludeId?: string) {
    if (await this.repo.findByName(name.trim(), excludeId)) {
      throw new ConflictError("SHIFT_EXISTS", `A shift named "${name.trim()}" already exists`);
    }
  }
}
