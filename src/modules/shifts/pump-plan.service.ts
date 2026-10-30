import type { AuthUser } from "../../shared/auth/context-user.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { PumpAttendantRepository } from "./pump-attendant.repository.js";
import { PumpPlanRepository } from "./pump-plan.repository.js";
import type { CreatePumpPlanSchema, PumpPlanQuerySchema, UpdatePumpPlanSchema } from "./pump-plan.schema.js";
import { assertSiteAccess, siteScope } from "./shift-scope.js";

/** Today, by the server's clock, as the calendar day the roster stores. */
function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The standing arrangements — who is usually on which pump, on which weekday
 * of which shift.
 *
 * A plan holds no history: it says what normally happens, and the rota says
 * what was actually worked. Saving one can also write it onto the days already
 * rostered, from today onward; days already past are never touched, because a
 * plan written today cannot have been the arrangement last month.
 */
export class PumpPlanService {
  constructor(private repo: PumpPlanRepository, private attendants: PumpAttendantRepository) {}

  list(query: PumpPlanQuerySchema, actor: AuthUser) {
    return this.repo.list({ ...query, siteId: siteScope(actor) ?? query.siteId });
  }

  async find(id: string, actor: AuthUser) {
    const plan = await this.repo.find(id);
    if (!plan) throw new NotFoundError("Pump plan");
    assertSiteAccess(plan.siteId, actor);
    return plan;
  }

  /**
   * One plan per weekday chosen. With `applyToRostered` it is also written
   * onto the days already rostered, which is how a new arrangement takes
   * effect this week rather than next.
   */
  async create(input: CreatePumpPlanSchema, actor: AuthUser) {
    const siteId = await this.validate(input, actor);
    const plans = await this.repo.create({
      siteId, siteShiftId: input.siteShiftId, userId: input.userId, pumpId: input.pumpId,
      nozzleIds: input.nozzleIds, weekdays: input.weekdays, status: input.status, createdBy: actor.userId,
    });
    const applied = input.applyToRostered
      ? await this.apply(plans, input.nozzleIds, input.pumpId, false)
      : { written: 0, replaced: 0, skipped: 0 };
    return { plans, applied, rosteredDays: await this.countRosterDays(plans) };
  }

  /**
   * Changes one plan. With `applyToRostered` the days already rostered are
   * rewritten to match — the rotation case, which the caller asks about first
   * because it changes days somebody may have arranged by hand.
   */
  async update(id: string, input: UpdatePumpPlanSchema, actor: AuthUser) {
    const plan = await this.find(id, actor);
    await this.validate({
      siteShiftId: plan.siteShiftId, userId: plan.userId,
      pumpId: input.pumpId ?? plan.pumpId,
      nozzleIds: input.nozzleIds ?? plan.nozzles.map((row) => row.nozzle.id),
    }, actor);

    const saved = await this.repo.update(id, input);
    const nozzleIds = saved.nozzles.map((row) => row.nozzle.id);
    const applied = input.applyToRostered && saved.status === "active"
      ? await this.apply([saved], nozzleIds, saved.pumpId, true)
      : { written: 0, replaced: 0, skipped: 0 };
    return { plan: saved, applied, rosteredDays: await this.countRosterDays([saved]) };
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    // The days already written from it stay: they are what was arranged, and
    // a plan is not a record of them.
    await this.repo.delete(id);
    return { id };
  }

  /** How many rostered days from today a plan reaches — what the form asks about. */
  async countRosterDays(plans: Array<{ userId: string; siteShiftId: string; weekday: number }>) {
    const days = await Promise.all(plans.map((plan) => this.repo.rosterDaysFor(plan, today())));
    return days.reduce((sum, rows) => sum + rows.length, 0);
  }

  /** Writes the plans onto the rostered days they reach, from today. */
  private async apply(
    plans: Array<{ id: string; userId: string; siteShiftId: string; weekday: number }>,
    nozzleIds: string[],
    pumpId: string,
    replace: boolean,
  ) {
    let written = 0;
    let replaced = 0;
    let skipped = 0;
    for (const plan of plans) {
      const result = await this.repo.applyFrom({ ...plan, pumpId, nozzleIds }, today(), replace);
      written += result.written;
      replaced += result.replaced;
      skipped += result.skipped;
    }
    /** `skipped`: days somebody had already arranged, left as they are. */
    return { written, replaced, skipped };
  }

  /**
   * Everything must belong to the same site as the shift: the pump, its
   * nozzles and the attendant — the same rules a day's assignment follows,
   * because a plan is only a way of writing those.
   */
  private async validate(
    input: { siteShiftId: string; userId: string; pumpId: string; nozzleIds: string[] },
    actor: AuthUser,
  ) {
    const siteShift = await this.attendants.findSiteShift(input.siteShiftId);
    if (!siteShift) throw new NotFoundError("Site shift");
    assertSiteAccess(siteShift.siteId, actor);
    if (siteShift.status !== 1) {
      throw new BusinessError("SITE_SHIFT_INACTIVE", `The "${siteShift.shift.name}" shift is switched off at this site`);
    }

    const pump = await this.attendants.findPump(input.pumpId);
    if (!pump) throw new NotFoundError("Pump");
    if (pump.siteId !== siteShift.siteId) {
      throw new BusinessError("PUMP_OTHER_SITE", "This pump is not at the shift's site");
    }
    if (pump.status !== "active") throw new BusinessError("PUMP_INACTIVE", `Pump "${pump.name}" is switched off`);

    const nozzleIds = [...new Set(input.nozzleIds)];
    const pumpNozzles = new Map(pump.nozzles.map((nozzle) => [nozzle.id, nozzle]));
    if (nozzleIds.some((id) => !pumpNozzles.has(id))) {
      throw new BusinessError("NOZZLE_OTHER_PUMP", `Only nozzles on pump "${pump.name}" can be chosen`);
    }
    const inactive = nozzleIds.map((id) => pumpNozzles.get(id)!).filter((nozzle) => nozzle.status !== "active");
    if (inactive.length) {
      throw new BusinessError("NOZZLE_INACTIVE",
        `Switched-off nozzles cannot be assigned: ${inactive.map((nozzle) => nozzle.name).join(", ")}`);
    }
    if (!(await this.attendants.findSiteUser(input.userId, siteShift.siteId))) {
      throw new BusinessError("USER_OTHER_SITE", "The attendant must be an active user assigned to this site");
    }
    return siteShift.siteId;
  }
}