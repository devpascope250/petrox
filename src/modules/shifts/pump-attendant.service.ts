import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { PumpAttendantRepository } from "./pump-attendant.repository.js";
import { CreatePumpAttendantSchema, PumpAttendantQuerySchema } from "./pump-attendant.schema.js";
import { assertSiteAccess, siteScope } from "./shift-scope.js";

export class PumpAttendantService {
  constructor(private repo: PumpAttendantRepository, private config: AppConfig) {}

  /** A site manager always sees his own site; anyone else may filter by one. */
  async list(query: PumpAttendantQuerySchema, actor: AuthUser) {
    return await this.repo.list({ ...query, siteId: siteScope(actor) ?? query.siteId });
  }

  async find(id: string, actor: AuthUser) {
    const row = await this.repo.find(id);
    if (!row) throw new NotFoundError("Pump attendant");
    assertSiteAccess(row.siteId, actor);
    return row;
  }

  async create(input: CreatePumpAttendantSchema, actor: AuthUser) {
    const siteId = await this.validate(input, actor);
    return this.repo.create(input, siteId);
  }

  async update(id: string, input: CreatePumpAttendantSchema, actor: AuthUser) {
    await this.find(id, actor);
    const siteId = await this.validate(input, actor, id);
    return await this.repo.update(id, input, siteId);
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    await this.repo.delete(id);
    return { id };
  }

  /**
   * Everything must belong to the same site as the shift: the pump, its
   * nozzles and the attendant. Returns that site, which is stored on the row.
   */
  private async validate(input: CreatePumpAttendantSchema, actor: AuthUser, excludeId?: string) {
    const siteShift = await this.repo.findSiteShift(input.siteShiftId);
    if (!siteShift) throw new NotFoundError("Site shift");
    assertSiteAccess(siteShift.siteId, actor);
    if (siteShift.status !== 1) {
      throw new BusinessError("SITE_SHIFT_INACTIVE", `The "${siteShift.shift.name}" shift is switched off at this site`);
    }

    const pump = await this.repo.findPump(input.pumpId);
    if (!pump) throw new NotFoundError("Pump");
    if (pump.siteId !== siteShift.siteId) {
      throw new BusinessError("PUMP_OTHER_SITE", "This pump is not at the shift's site");
    }
    if (pump.status !== "active") {
      throw new BusinessError("PUMP_INACTIVE", `Pump "${pump.name}" is switched off`);
    }

    const nozzleIds = [...new Set(input.nozzleIds)];
    const pumpNozzles = new Map(pump.nozzles.map((nozzle) => [nozzle.id, nozzle]));
    const foreign = nozzleIds.filter((id) => !pumpNozzles.has(id));
    if (foreign.length) {
      throw new BusinessError("NOZZLE_OTHER_PUMP", `Only nozzles on pump "${pump.name}" can be chosen`);
    }
    const inactive = nozzleIds.map((id) => pumpNozzles.get(id)!).filter((nozzle) => nozzle.status !== "active");
    if (inactive.length) {
      throw new BusinessError("NOZZLE_INACTIVE", `Switched-off nozzles cannot be assigned: ${inactive.map((n) => n.name).join(", ")}`);
    }

    if (!(await this.repo.findSiteUser(input.userId, siteShift.siteId))) {
      throw new BusinessError("USER_OTHER_SITE", "The attendant must be an active user assigned to this site");
    }

    if (await this.repo.findDuplicate(input, excludeId)) {
      throw new ConflictError("ATTENDANT_EXISTS", "This attendant is already on this pump for that day and shift");
    }
    // A nozzle is handled by one person per shift, or its readings have no owner.
    const taken = await this.repo.findTakenNozzles({ ...input, nozzleIds }, excludeId);
    if (taken.length) {
      const who = taken
        .map((row) => `${row.nozzle.name} (${row.pumpAttendant.user.firstName} ${row.pumpAttendant.user.lastName})`)
        .join(", ");
      throw new ConflictError("NOZZLE_TAKEN", `Already assigned for that day and shift: ${who}`);
    }
    return siteShift.siteId;
  }
}
