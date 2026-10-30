import { Prisma } from "../../../prisma/generated/prisma/client.js";
import { isSiteBound, type AuthUser } from "../../shared/auth/context-user.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { fromDate } from "../shifts/shift-scope.js";
import { presentPumpIndex, PumpIndexRepository } from "./pump-index.repository.js";
import type {
  CreatePumpIndexInput, PumpIndexListQuery, PumpIndexOpeningQuery, UpdatePumpIndexInput,
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
   */
  async opening(query: PumpIndexOpeningQuery, actor: AuthUser) {
    const nozzle = await this.repo.nozzleFor(query.nozzleId, this.scope(actor));
    const previous = await this.repo.latestFor(nozzle.id);
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
      nozzle, shiftSiteId: input.shiftSiteId, dateOn: input.dateOn,
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
