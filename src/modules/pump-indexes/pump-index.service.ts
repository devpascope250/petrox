import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { fromDate } from "../shifts/shift-scope.js";
import { presentPumpIndex, PumpIndexRepository } from "./pump-index.repository.js";
import type {
  CreatePumpIndexInput, PumpIndexListQuery, PumpIndexOpeningQuery, PumpIndexRosterQuery, UpdatePumpIndexInput,
} from "./pump-index.schema.js";

const decimal = (value: string | number) => new Prisma.Decimal(value);

/**
 * The pump index readings, and the three rules that hold them together.
 *
 * 1. **The chain.** A nozzle's readings run one after another: `startIndex` is
 *    the previous reading's `endIndex`, derived here and never taken from the
 *    form. Only the first reading on a nozzle may carry an opening figure.
 * 2. **Approved is final.** A reading with `confirmedBy` set is never edited
 *    again, and nothing deletes a reading at all — so no figure anyone has
 *    approved can be rewritten behind their back.
 * 3. **A counter does not run backwards.** `endIndex` is never below the
 *    opening figure, and a reading is never recorded for a day before the last
 *    one on its nozzle.
 * 4. **A reading belongs to whoever worked the shift.** The time table must put
 *    the attendant on that shift that day, and the rota on that pump and that
 *    nozzle — the same three facts the POS checks before it lets them confirm
 *    a sale, checked here in the same order and refused with the same codes.
 *    There is no way to record a reading for a shift nobody was rostered on:
 *    the roster has to be filled in first.
 */
export class PumpIndexService {
  constructor(private repo: PumpIndexRepository) {}

  async list(query: PumpIndexListQuery, actor: AuthUser) {
    const { rows, total, summary } = await this.repo.list(query, this.scope(actor));
    return { ...paginatedData(rows.map(presentPumpIndex), total, query), summary };
  }

  async find(id: string, actor: AuthUser) {
    const reading = await this.repo.find(id, this.scope(actor));
    if (!reading) throw new NotFoundError("Pump index reading");
    return presentPumpIndex(reading);
  }

  /**
   * What a new reading on a nozzle opens at, for the form to show before
   * anything is typed: the last reading's close, the price in force, and
   * whether this would be the first reading on the nozzle — the one case where
   * the opening figure is typed rather than carried.
   *
   * `exceptId` leaves the reading being corrected out of the chain, so a
   * correction is told what it opens at and whether it is itself the first.
   */
  async opening(query: PumpIndexOpeningQuery, actor: AuthUser) {
    const nozzle = await this.repo.nozzleFor(query.nozzleId, this.scope(actor));
    const previous = await this.repo.latestFor(nozzle.id, query.exceptId);
    const price = await this.repo.priceFor(nozzle.cuve.item).catch(() => null);
    return {
      nozzle: { id: nozzle.id, name: nozzle.name, nozzleCode: nozzle.nozzleCode },
      pump: { id: nozzle.pump.id, name: nozzle.pump.name },
      item: { id: nozzle.cuve.item.id, name: nozzle.cuve.item.name },
      /** Empty for the first reading on this nozzle, which types its own. */
      previous: previous && {
        id: previous.id, dateOn: fromDate(previous.dateOn),
        endIndex: Number(previous.endIndex), approved: previous.confirmedBy !== null,
      },
      /** What the new reading will open at: carried, or 0 to be typed over. */
      startIndex: previous ? Number(previous.endIndex) : 0,
      isFirst: previous === null,
      /** The price in force now; `null` when the product has none set. */
      sellingPrice: price === null ? null : Number(price),
    };
  }

  /**
   * Who the time table puts on a shift that day, and what each of them may be
   * read for: their pumps, the nozzles of each, the figure every nozzle opens
   * at, and the reading it already has if someone has recorded it.
   *
   * This is the form's cascade in one answer — shift and day, then attendant,
   * then pump, then nozzle — so nothing has to be looked up by hand and an
   * already-recorded nozzle is visible before anything is typed.
   */
  async roster(query: PumpIndexRosterQuery, actor: AuthUser) {
    const site = this.scope(actor);
    const shift = await this.repo.shiftForRoster(query.shiftSiteId, site);
    const rostered = await this.repo.rosterFor(query.shiftSiteId, query.dateOn);

    // Every nozzle anyone on the shift holds, each looked up once however many
    // attendants share it.
    const nozzles = new Map<string, { id: string; name: string; nozzleCode: string; status: string;
      item: { id: string; name: string; baseUnitId: string | null;
        baseUnit: { id: string; name: string; code: string } | null } }>();
    for (const person of rostered) {
      for (const rota of person.rota) {
        for (const { nozzle } of rota.pumpAttendantNozzles) {
          nozzles.set(nozzle.id, { id: nozzle.id, name: nozzle.name, nozzleCode: nozzle.nozzleCode,
            status: nozzle.status, item: nozzle.cuve.item });
        }
      }
    }
    const ids = [...nozzles.keys()];
    const [openings, recorded] = await Promise.all([
      this.repo.openingFor(ids),
      ids.length ? this.repo.recordedFor(ids, query.shiftSiteId, query.dateOn) : [],
    ]);
    // One price lookup per product, not per nozzle.
    const items = [...new Map([...nozzles.values()].map((nozzle) => [nozzle.item.id, nozzle.item])).values()];
    const prices = new Map(await Promise.all(items.map(async (item) =>
      [item.id, await this.repo.priceFor(item).then(Number).catch(() => null)] as const)));

    const openingOf = new Map(openings.map((row) => [row.nozzleId, row.previous]));
    const readingOf = new Map(recorded.map((row) => [row.nozzleId, row]));
    const presentNozzle = (nozzle: NonNullable<ReturnType<typeof nozzles.get>>) => {
      const previous = openingOf.get(nozzle.id) ?? null;
      const reading = readingOf.get(nozzle.id);
      return {
        id: nozzle.id, name: nozzle.name, nozzleCode: nozzle.nozzleCode, status: nozzle.status,
        item: { id: nozzle.item.id, name: nozzle.item.name, baseUnit: nozzle.item.baseUnit },
        /** What a new reading here opens at: the close of the last one. */
        startIndex: previous ? Number(previous.endIndex) : 0,
        isFirst: previous === null,
        previous: previous && { id: previous.id, dateOn: fromDate(previous.dateOn),
          endIndex: Number(previous.endIndex), approved: previous.confirmedBy !== null },
        /** Already recorded for this shift and day — there is only ever one. */
        reading: reading && { id: reading.id, startIndex: Number(reading.startIndex),
          endIndex: Number(reading.endIndex), approved: reading.confirmedBy !== null,
          attendant: reading.attendant },
        sellingPrice: prices.get(nozzle.item.id) ?? null,
      };
    };

    return {
      shift, dateOn: query.dateOn,
      /** Empty when nobody was rostered: the time table has to be filled in first. */
      attendants: rostered.map((person) => ({
        user: person.user,
        isChief: person.isChief,
        isSuport: person.isSuport,
        extraShift: Boolean(person.extraShift),
        /** 0 planned, 1 present. The absent are not listed at all. */
        status: person.status,
        pumps: person.rota.map((rota) => ({
          id: rota.pump.id, name: rota.pump.name, status: rota.pump.status,
          nozzles: rota.pumpAttendantNozzles
            .map(({ nozzle }) => presentNozzle(nozzles.get(nozzle.id)!))
            .sort((left, right) => left.name.localeCompare(right.name)),
        })),
      })),
    };
  }

  /**
   * Records the close of a shift on one nozzle. The pump, the product and the
   * site come from the nozzle; the opening figure comes from the reading
   * before it. Nothing but the closing figure — and, for the first reading on
   * a nozzle, the opening one — is taken from the form.
   */
  async create(input: CreatePumpIndexInput, actor: AuthUser) {
    const nozzle = await this.repo.nozzleFor(input.nozzleId, this.scope(actor));
    if (nozzle.status !== "active") throw new BusinessError("NOZZLE_INACTIVE", `${nozzle.name} is not active`);
    if (nozzle.pump.status !== "active") throw new BusinessError("PUMP_INACTIVE", `${nozzle.pump.name} is not active`);
    await this.repo.shiftFor(input.shiftSiteId, nozzle.pump.siteId);

    await this.assertOnDuty(input.attendantId, input.shiftSiteId, input.dateOn, nozzle);

    const previous = await this.repo.latestFor(nozzle.id);
    if (previous && input.startIndex !== undefined) {
      throw new BusinessError("START_INDEX_IS_CARRIED",
        `${nozzle.name} opens at ${previous.endIndex.toFixed(2)}, carried from the reading of `
        + `${fromDate(previous.dateOn)}: only the first reading on a nozzle sets its own`);
    }
    if (previous && input.dateOn < fromDate(previous.dateOn)) {
      throw new BusinessError("READING_OUT_OF_ORDER",
        `${nozzle.name} already has a reading for ${fromDate(previous.dateOn)}, so this one cannot be `
        + "for an earlier day; a reading always follows the last one");
    }

    const startIndex = previous ? previous.endIndex : decimal(input.startIndex ?? 0);
    const endIndex = decimal(input.endIndex);
    this.checkDirection(startIndex, endIndex, nozzle.name);

    const sellingPrice = input.sellingPrice !== undefined
      ? decimal(input.sellingPrice)
      // Snapshot of the price in force: a later change must not rewrite what
      // this shift sold at.
      : await this.repo.priceFor(nozzle.cuve.item);

    const created = await this.repo.create({
      nozzle, shiftSiteId: input.shiftSiteId, dateOn: input.dateOn, attendantId: input.attendantId,
      startIndex, endIndex, sellingPrice: decimal(sellingPrice.toString()),
      createdBy: actor.userId,
    });
    return presentPumpIndex(created);
  }

  /**
   * Corrects a reading that has **not** been approved, and only while it is
   * the last on its nozzle: a later reading already opens where this one
   * closes, so changing it now would leave the rest of the chain saying
   * something else.
   */
  async update(id: string, input: UpdatePumpIndexInput, actor: AuthUser) {
    const site = this.scope(actor);
    const reading = await this.repo.findForWrite(id, site);
    if (!reading) throw new NotFoundError("Pump index reading");
    if (reading.confirmedBy) {
      throw new BusinessError("READING_APPROVED",
        "This reading is approved, so it can no longer be changed; record the correction as the next reading");
    }
    const later = await this.repo.hasLaterThan(reading);
    if (later) {
      throw new BusinessError("CHAIN_CONTINUES",
        `The reading of ${fromDate(later.dateOn)} on this nozzle already opens where this one closes, `
        + "so this one can no longer be changed");
    }

    const nozzle = await this.repo.nozzleFor(reading.nozzleId, site);
    if (input.shiftSiteId) await this.repo.shiftFor(input.shiftSiteId, nozzle.pump.siteId);

    // The attendant, the shift and the day decide each other, so a change to
    // any of them is checked against the roster and the rota again — as the
    // whole of it, not just the part that moved.
    if (input.attendantId || input.shiftSiteId || input.dateOn) {
      await this.assertOnDuty(
        input.attendantId ?? reading.attendantId,
        input.shiftSiteId ?? reading.shiftSiteId,
        input.dateOn ?? fromDate(reading.dateOn),
        nozzle,
      );
    }

    const previous = await this.repo.latestFor(reading.nozzleId, reading.id);
    if (input.startIndex !== undefined && previous) {
      throw new BusinessError("START_INDEX_IS_CARRIED",
        `${nozzle.name} opens at ${previous.endIndex.toFixed(2)}, carried from the reading of `
        + `${fromDate(previous.dateOn)}: only the first reading on a nozzle sets its own`);
    }
    if (input.dateOn && previous && input.dateOn < fromDate(previous.dateOn)) {
      throw new BusinessError("READING_OUT_OF_ORDER",
        `${nozzle.name} already has a reading for ${fromDate(previous.dateOn)}, so this one cannot be `
        + "for an earlier day");
    }

    const startIndex = input.startIndex === undefined ? reading.startIndex : decimal(input.startIndex);
    const endIndex = input.endIndex === undefined ? reading.endIndex : decimal(input.endIndex);
    this.checkDirection(startIndex, endIndex, nozzle.name);

    const updated = await this.repo.update(id, {
      shiftSiteId: input.shiftSiteId,
      dateOn: input.dateOn,
      attendantId: input.attendantId,
      startIndex: input.startIndex === undefined ? undefined : startIndex,
      endIndex: input.endIndex === undefined ? undefined : endIndex,
      sellingPrice: input.sellingPrice === undefined ? undefined : decimal(input.sellingPrice),
    });
    return presentPumpIndex(updated);
  }

  /**
   * Approves a reading, which freezes it: from here it is neither edited nor
   * deleted, and the readings that follow it rest on a figure someone signed
   * for.
   */
  async approve(id: string, actor: AuthUser) {
    const reading = await this.repo.findForWrite(id, this.scope(actor));
    if (!reading) throw new NotFoundError("Pump index reading");
    return presentPumpIndex(await this.repo.approve(id, actor.userId));
  }

  /**
   * That the attendant was on duty there: the time table puts them on that
   * shift that day, and the rota on that pump and that nozzle.
   *
   * The same three questions the POS asks before it lets someone confirm a
   * sale, in the same order and with the same codes — a reading and a sale are
   * then only ever recorded against a person the roster agrees was there.
   *
   * Both read the rota **of that day**, so a reading typed a week late is
   * checked against the pump they held then, not the one they hold now.
   */
  private async assertOnDuty(attendantId: string, shiftSiteId: string, dateOn: string,
    nozzle: { id: string; name: string; pump: { id: string; name: string } }) {
    const rostered = await this.repo.rosteredOn(attendantId, shiftSiteId, dateOn);
    if (!rostered) {
      throw new BusinessError("ATTENDANT_NOT_ON_SHIFT",
        `The time table does not put this attendant on that shift on ${dateOn}, or marks them absent`);
    }
    const who = `${rostered.user.firstName} ${rostered.user.lastName}`.trim();
    // The rota of that very rostered day, not of the shift in general.
    const rota = await this.repo.rotaFor(rostered.id);
    const onPump = rota.filter((row) => row.pump.id === nozzle.pump.id);
    if (onPump.length === 0) {
      throw new BusinessError("ATTENDANT_NOT_ON_PUMP",
        `${who} is not on the rota for ${nozzle.pump.name} in that shift`);
    }
    const onNozzle = onPump.some((row) =>
      row.pumpAttendantNozzles.some(({ nozzle: theirs }) => theirs.id === nozzle.id));
    if (!onNozzle) {
      throw new BusinessError("ATTENDANT_NOT_ON_NOZZLE",
        `${nozzle.name} is not one of ${who}'s nozzles on ${nozzle.pump.name} in that shift`);
    }
    return rostered;
  }

  /** A counter does not run backwards, whatever was typed. */
  private checkDirection(startIndex: Prisma.Decimal, endIndex: Prisma.Decimal, nozzle: string) {
    if (endIndex.lessThan(startIndex)) {
      throw new BusinessError("INDEX_GOES_BACKWARDS",
        `${nozzle} opens at ${startIndex.toFixed(2)}, so it cannot close at ${endIndex.toFixed(2)}`);
    }
  }

  /** No site for a super administrator, their own for site staff. */
  private scope(actor: AuthUser) {
    if (actor.position === "superAdmin") return undefined;
    if (!isSiteBound(actor) || !actor.siteId) {
      throw forbidden("Pump index readings require a super administrator or site staff assigned to a site");
    }
    return actor.siteId;
  }
}
