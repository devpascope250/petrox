import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { priceInForce } from "../mobile/transactions/sale-rules.js";
import { fromDate, fromTime, toDate } from "../shifts/shift-scope.js";
import type { CreatePumpIndexInput, PumpIndexListQuery, UpdatePumpIndexInput } from "./pump-index.schema.js";

/** `TblTimeTable.status`: 0 planned, 1 present, 2 absent — as the POS reads it. */
const ABSENT = 2;

/** Two decimals: what the index and money columns hold. */
const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);

const readingSelect = {
  id: true, dateOn: true, startIndex: true, endIndex: true, sellingPrice: true,
  confirmedBy: true, confirmedAt: true, createdAt: true, attendantId: true,
  /** Whose shift on this nozzle it was, from the time table and the rota. */
  attendant: { select: { id: true, firstName: true, lastName: true, phone: true } },
  pump: { select: { id: true, name: true } },
  nozzle: { select: { id: true, name: true, nozzleCode: true } },
  item: { select: { id: true, name: true, baseUnit: { select: { id: true, name: true, code: true } } } },
  site: { select: { id: true, name: true } },
  shiftSite: { select: { id: true, shift: { select: { id: true, name: true, startAt: true, endAt: true } } } },
  user: { select: { id: true, firstName: true, lastName: true } },
  confirmedUser: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PumpIndexSelect;

type Reading = Prisma.PumpIndexGetPayload<{ select: typeof readingSelect }>;

/**
 * A reading as the screens read it: the figures as numbers, the working day as
 * the calendar day it is stored as, and what the shift put through the nozzle —
 * `endIndex - startIndex` — with what it was worth at the price recorded.
 */
export function presentPumpIndex(reading: Reading) {
  const quantity = reading.endIndex.minus(reading.startIndex);
  const { shiftSite, ...rest } = reading;
  return {
    ...rest,
    dateOn: fromDate(reading.dateOn),
    startIndex: Number(reading.startIndex),
    endIndex: Number(reading.endIndex),
    sellingPrice: Number(reading.sellingPrice),
    /** The litres through the nozzle over the shift. */
    quantity: Number(quantity),
    /** What those litres came to at the price recorded against the reading. */
    amount: Number(money(quantity.times(reading.sellingPrice))),
    shift: shiftSite && {
      id: shiftSite.id, name: shiftSite.shift.name,
      startAt: fromTime(shiftSite.shift.startAt), endAt: fromTime(shiftSite.shift.endAt),
    },
    /** Approved readings are frozen: no edit, and nothing deletes one. */
    approved: reading.confirmedBy !== null,
  };
}

/**
 * The pump index readings: one nozzle's meter at the open and close of a
 * shift. The readings of a nozzle are a chain — each one opens where the last
 * closed — so only the closing figure is ever typed, and nothing here deletes
 * one.
 */
export class PumpIndexRepository {
  constructor(private db: PrismaClient) {}

  private where(query: PumpIndexListQuery, siteId: string | undefined): Prisma.PumpIndexWhereInput {
    return {
      ...(siteId ? { siteId } : query.siteId ? { siteId: query.siteId } : {}),
      ...(query.pumpId ? { pumpId: query.pumpId } : {}),
      ...(query.nozzleId ? { nozzleId: query.nozzleId } : {}),
      ...(query.shiftSiteId ? { shiftSiteId: query.shiftSiteId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.attendantId ? { attendantId: query.attendantId } : {}),
      ...(query.approved === undefined ? {} : { confirmedBy: query.approved ? { not: null } : null }),
      ...(query.startDate || query.endDate ? { dateOn: { gte: query.startDate, lte: query.endDate } } : {}),
    };
  }

  /**
   * A page of readings, newest working day first, with the totals over
   * everything the filters match. The litres come out as the two sums'
   * difference, which is the same figure as adding up each reading's own.
   */
  async list(query: PumpIndexListQuery, siteId: string | undefined) {
    const where = this.where(query, siteId);
    const [rows, total, sums, approved] = await this.db.$transaction([
      this.db.pumpIndex.findMany({
        where, ...paginationArgs(query),
        orderBy: [{ dateOn: "desc" }, { createdAt: "desc" }],
        select: readingSelect,
      }),
      this.db.pumpIndex.count({ where }),
      this.db.pumpIndex.aggregate({ where, _sum: { startIndex: true, endIndex: true } }),
      this.db.pumpIndex.count({ where: { ...where, confirmedBy: { not: null } } }),
    ]);
    const quantity = (sums._sum.endIndex ?? new Prisma.Decimal(0)).minus(sums._sum.startIndex ?? 0);
    return {
      rows, total,
      summary: {
        readings: total,
        approved,
        /** Still editable, and still to be approved. */
        pending: total - approved,
        quantity: Number(quantity),
      },
    };
  }

  find(id: string, siteId: string | undefined) {
    return this.db.pumpIndex.findFirst({ where: { id, ...(siteId ? { siteId } : {}) }, select: readingSelect });
  }

  /** The reading with what a correction needs to know: whether it is approved, and its chain. */
  findForWrite(id: string, siteId: string | undefined) {
    return this.db.pumpIndex.findFirst({
      where: { id, ...(siteId ? { siteId } : {}) },
      select: { id: true, nozzleId: true, dateOn: true, startIndex: true, endIndex: true,
        confirmedBy: true, confirmedAt: true, siteId: true, shiftSiteId: true, attendantId: true },
    });
  }

  /**
   * The nozzle a reading is recorded against, with the pump it sits on and the
   * product its tank holds — which is where `pumpId`, `itemId` and `siteId`
   * come from, rather than from whatever the form sent.
   */
  async nozzleFor(nozzleId: string, siteId: string | undefined) {
    const nozzle = await this.db.tblNozzle.findFirst({
      where: { id: nozzleId },
      select: {
        id: true, name: true, nozzleCode: true, status: true,
        pump: { select: { id: true, name: true, siteId: true, status: true } },
        cuve: { select: { id: true, name: true, item: { select: { id: true, name: true, status: true, baseUnitId: true } } } },
      },
    });
    if (!nozzle || (siteId && nozzle.pump.siteId !== siteId)) throw new NotFoundError("Nozzle at this site");
    return nozzle;
  }

  /**
   * The shift the form is cascading from, named for the answer. Site staff are
   * held to their own site here as everywhere else.
   */
  async shiftForRoster(shiftSiteId: string, siteId: string | undefined) {
    const shift = await this.db.tblShiftSite.findFirst({
      where: { id: shiftSiteId, ...(siteId ? { siteId } : {}) },
      select: { id: true, status: true, siteId: true,
        site: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startAt: true, endAt: true } } },
    });
    if (!shift) throw new NotFoundError("Shift at this site");
    return {
      id: shift.id, status: shift.status, site: shift.site,
      name: shift.shift.name, startAt: fromTime(shift.shift.startAt), endAt: fromTime(shift.shift.endAt),
    };
  }

  /** The shift a reading belongs to: it must run at the nozzle's own site. */
  async shiftFor(shiftSiteId: string, siteId: string) {
    const shift = await this.db.tblShiftSite.findFirst({
      where: { id: shiftSiteId, siteId },
      select: { id: true, status: true, shift: { select: { name: true } } },
    });
    if (!shift) throw new BusinessError("SHIFT_NOT_AT_SITE", "That shift does not run at this site");
    if (shift.status !== 1) {
      throw new BusinessError("SHIFT_SWITCHED_OFF", `${shift.shift.name} is switched off at this site`);
    }
    return shift;
  }

  /**
   * The reading a new one on this nozzle follows: the latest by working day,
   * and by when it was typed within a day. `null` when the nozzle has none, in
   * which case the new reading is the first and opens the chain.
   */
  latestFor(nozzleId: string, exceptId?: string) {
    return this.db.pumpIndex.findFirst({
      where: { nozzleId, ...(exceptId ? { id: { not: exceptId } } : {}) },
      orderBy: [{ dateOn: "desc" }, { createdAt: "desc" }],
      select: { id: true, dateOn: true, endIndex: true, confirmedBy: true },
    });
  }

  /** Whether any reading on this nozzle follows the one given — the rest of its chain. */
  async hasLaterThan(reading: { id: string; nozzleId: string; dateOn: Date }) {
    const later = await this.db.pumpIndex.findFirst({
      where: { nozzleId: reading.nozzleId, id: { not: reading.id }, dateOn: { gte: reading.dateOn } },
      orderBy: [{ dateOn: "desc" }, { createdAt: "desc" }],
      select: { id: true, dateOn: true, createdAt: true },
    });
    return later;
  }

  /**
   * The roster row putting an attendant on this shift that day: the time table
   * is the authority on **when** someone works, and `status` 2 is absent, which
   * never counts. `null` when they are not on it.
   */
  rosteredOn(attendantId: string, shiftSiteId: string, dateOn: string) {
    return this.db.tblTimeTable.findFirst({
      where: { userId: attendantId, siteShiftId: shiftSiteId, dateOn: toDate(dateOn), status: { not: ABSENT } },
      select: { id: true, status: true, isChief: true, isSuport: true, extraShift: true,
        user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });
  }

  /**
   * The rota rows of one rostered day: which pumps are theirs on it, and the
   * nozzles of each. The day is the roster row's own, so a reading recorded
   * late is checked against the rota **as it was that day**, not as it stands
   * now — the forecourt rotates.
   */
  rotaFor(timeTableId: string) {
    return this.db.tblPumpAttendant.findMany({
      where: { timeTableId },
      orderBy: { pump: { name: "asc" } },
      select: {
        id: true,
        pump: { select: { id: true, name: true, siteId: true, status: true } },
        pumpAttendantNozzles: {
          select: { nozzle: { select: { id: true, name: true, nozzleCode: true, status: true,
            cuve: { select: { id: true, name: true,
              item: { select: { id: true, name: true, status: true, baseUnitId: true,
                baseUnit: { select: { id: true, name: true, code: true } } } } } } } } },
        },
      },
    });
  }

  /**
   * Everyone the time table puts on a shift that day, with the pumps and
   * nozzles the rota gives each of them — what the recording form cascades
   * down, in one answer.
   */
  async rosterFor(shiftSiteId: string, dateOn: string) {
    const rostered = await this.db.tblTimeTable.findMany({
      where: { siteShiftId: shiftSiteId, dateOn: toDate(dateOn), status: { not: ABSENT } },
      orderBy: [{ isChief: "desc" }, { isSuport: "desc" }],
      select: { id: true, status: true, isChief: true, isSuport: true, extraShift: true,
        user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    });
    const rotas = await Promise.all(rostered.map((row) => this.rotaFor(row.id)));
    return rostered.map((row, index) => ({ ...row, rota: rotas[index] }));
  }

  /**
   * What each of these nozzles opens at: the close of its own last reading.
   * One query each — a shift is a handful of nozzles, and reading every row
   * ever recorded to find the last one would not be.
   */
  openingFor(nozzleIds: string[]) {
    return Promise.all(nozzleIds.map(async (nozzleId) => ({ nozzleId, previous: await this.latestFor(nozzleId) })));
  }

  /** The readings these nozzles already have for one shift on one day. */
  recordedFor(nozzleIds: string[], shiftSiteId: string, dateOn: string) {
    return this.db.pumpIndex.findMany({
      where: { nozzleId: { in: nozzleIds }, shiftSiteId, dateOn: toDate(dateOn) },
      select: { id: true, nozzleId: true, startIndex: true, endIndex: true, confirmedBy: true,
        attendant: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  /** The price in force for a product, for a reading that does not carry its own. */
  priceFor(item: { id: string; name: string; baseUnitId: string | null }) {
    return priceInForce(this.db, item);
  }

  async create(data: {
    nozzle: { id: string; pump: { id: string; siteId: string }; cuve: { item: { id: string } } };
    shiftSiteId: string; dateOn: string; attendantId: string;
    startIndex: Prisma.Decimal; endIndex: Prisma.Decimal; sellingPrice: Prisma.Decimal;
    createdBy: string;
  }) {
    try {
      return await this.db.pumpIndex.create({
        data: {
          pumpId: data.nozzle.pump.id, nozzleId: data.nozzle.id, itemId: data.nozzle.cuve.item.id,
          siteId: data.nozzle.pump.siteId, shiftSiteId: data.shiftSiteId, dateOn: toDate(data.dateOn),
          attendantId: data.attendantId,
          startIndex: data.startIndex, endIndex: data.endIndex, sellingPrice: data.sellingPrice,
          createdBy: data.createdBy,
        },
        select: readingSelect,
      });
    } catch (error) {
      // The unique key on (nozzle, shift, day): one reading each, no more.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BusinessError("READING_ALREADY_RECORDED",
          "This nozzle already has a reading for that shift on that day");
      }
      throw error;
    }
  }

  async update(id: string, data: {
    shiftSiteId?: string; dateOn?: string; attendantId?: string;
    startIndex?: Prisma.Decimal; endIndex?: Prisma.Decimal; sellingPrice?: Prisma.Decimal;
  }) {
    try {
      return await this.db.pumpIndex.update({
        where: { id },
        data: {
          ...(data.shiftSiteId ? { shiftSiteId: data.shiftSiteId } : {}),
          ...(data.dateOn ? { dateOn: toDate(data.dateOn) } : {}),
          ...(data.attendantId ? { attendantId: data.attendantId } : {}),
          ...(data.startIndex ? { startIndex: data.startIndex } : {}),
          ...(data.endIndex ? { endIndex: data.endIndex } : {}),
          ...(data.sellingPrice ? { sellingPrice: data.sellingPrice } : {}),
        },
        select: readingSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BusinessError("READING_ALREADY_RECORDED",
          "This nozzle already has a reading for that shift on that day");
      }
      throw error;
    }
  }

  /**
   * Stamps the approval, and only on a reading that has none: two approvals
   * arriving at once, the second finds nothing to claim.
   */
  async approve(id: string, userId: string) {
    const claimed = await this.db.pumpIndex.updateMany({
      where: { id, confirmedBy: null },
      data: { confirmedBy: userId, confirmedAt: new Date() },
    });
    if (claimed.count === 0) throw new BusinessError("READING_APPROVED", "This reading is already approved");
    return this.db.pumpIndex.findUniqueOrThrow({ where: { id }, select: readingSelect });
  }
}
