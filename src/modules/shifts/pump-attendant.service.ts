import type { AppConfig } from "../../config/env.js";
import type { AuthUser } from "../../shared/auth/context-user.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { PumpAttendantRepository } from "./pump-attendant.repository.js";
import type {
  CopyPumpAttendantWeekSchema, CreatePumpAttendantSchema, PumpAttendantQuerySchema, UpdatePumpAttendantSchema,
} from "./pump-attendant.schema.js";
import { assertSiteAccess, fromDate, siteScope } from "./shift-scope.js";

/**
 * Which pump an attendant works, and the nozzles of it, **on each rostered
 * day**.
 *
 * A pump assignment hangs off the roster row, so the time table stays the one
 * place that says who works when: a day it does not roster them on is reported
 * back, never written. That is what lets the rota rotate — the same person on
 * another pump next week — and what lets a sale or a meter reading for a past
 * day be checked against the rota **as it was that day**.
 */
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

  /**
   * Writes the assignment to each day given, and says what it did:
   * `assigned` for the days written, `notRostered` for the days the time table
   * does not put them on that shift, and `alreadyHeld` for the days they were
   * already on that pump.
   */
  async create(input: CreatePumpAttendantSchema, actor: AuthUser) {
    await this.validate(input, actor);

    const days = [...new Set(input.dates)].sort();
    const roster = await this.repo.rosterRows(input.userId, input.siteShiftId, days);
    const rosteredOn = new Map(roster.map((row) => [fromDate(row.dateOn), row]));
    const held = await this.repo.held(input.userId, input.siteShiftId, days);
    const samePump = new Set(held
      .filter((row) => row.pumpId === input.pumpId)
      .map((row) => fromDate(row.timeTable.dateOn)));

    const toWrite = days.filter((day) => rosteredOn.has(day) && !samePump.has(day));
    if (toWrite.length === 0) {
      // Nothing to do, and the reason matters: say which it is rather than
      // answering with an empty success.
      if (roster.length === 0) {
        throw new BusinessError("NOT_ROSTERED",
          "The time table does not put this attendant on that shift on any of those days."
          + " Roster the days first, under Shifts → Time table.");
      }
      throw new ConflictError("ATTENDANT_EXISTS",
        "This attendant is already on that pump on every day chosen");
    }

    const written = await this.repo.createMany(
      input,
      toWrite.map((day) => rosteredOn.get(day)!),
    );
    return {
      assigned: written,
      /** Days the roster does not cover, which is why they were not written. */
      notRostered: days.filter((day) => !rosteredOn.has(day)),
      /** Days that already had this pump, left as they were. */
      alreadyHeld: [...samePump].filter((day) => days.includes(day)).sort(),
      /** The other pumps this person already holds on those days. */
      otherPumps: held
        .filter((row) => row.pumpId !== input.pumpId)
        .map((row) => ({ dateOn: fromDate(row.timeTable.dateOn), pump: row.pump.name })),
    };
  }

  /** One day's assignment: its pump and the nozzles of it. */
  async update(id: string, input: UpdatePumpAttendantSchema, actor: AuthUser) {
    const existing = await this.find(id, actor);
    await this.validate(
      { ...input, siteShiftId: existing.siteShiftId, userId: existing.userId, dates: [existing.dateOn] },
      actor,
    );
    if (await this.repo.findDuplicate(existing.roster.id, input.pumpId, id)) {
      throw new ConflictError("ATTENDANT_EXISTS",
        `This attendant is already on that pump on ${existing.dateOn}`);
    }
    return await this.repo.update(id, input);
  }

  async delete(id: string, actor: AuthUser) {
    await this.find(id, actor);
    await this.repo.delete(id);
    return { id };
  }

  /** The next week's rota from this one's, for the days the roster covers. */
  async copyWeek(input: CopyPumpAttendantWeekSchema, actor: AuthUser) {
    const siteId = siteScope(actor) ?? input.siteId;
    if (siteId) assertSiteAccess(siteId, actor);
    return this.repo.copyWeek(input.startDate, siteId);
  }

  /**
   * Everything must belong to the same site as the shift: the pump, its
   * nozzles and the attendant.
   */
  private async validate(
    input: Omit<CreatePumpAttendantSchema, "dates"> & { dates: string[] },
    actor: AuthUser,
  ) {
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
    // Several attendants may hold the same nozzle on one day: a handover is
    // real, and the meter reading for that shift is one reading either way.
    return siteShift.siteId;
  }
}
