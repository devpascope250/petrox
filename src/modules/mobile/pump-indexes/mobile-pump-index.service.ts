import { Prisma, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { BusinessError } from "../../../utils/errors.js";
import { PumpIndexRepository, presentPumpIndex, type NewReading } from "../../pump-indexes/pump-index.repository.js";
import { fromDate, fromTime } from "../../shifts/shift-scope.js";
import { attendantBy, rosteredNow } from "../transactions/sale-rules.js";
import type { MobileAttendantInput, RecordPumpIndexesInput } from "./mobile-pump-index.schema.js";

/**
 * Whether a shift's own hours are already behind the clock. An overnight shift
 * — one whose end is before its start — is never "ended" by the clock alone,
 * since the small hours are still part of it.
 */
function ended(startAt: string, endAt: string, clock: string) {
  return startAt < endAt && clock >= endAt;
}

/** Two decimals: what the index and money columns hold. */
const money = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value).toDecimalPlaces(2);

/**
 * The meter readings as the POS takes them: the attendant signs with phone and
 * PIN, is shown the counters they are allowed to read, and writes them down.
 *
 * Nothing here is taken on trust from the device but the figures themselves.
 * **Who** comes from the phone and PIN; **where** from the time table and the
 * rota of that rostered day — the same three facts a sale is checked against;
 * **what it opens at** from the nozzle's own last reading. A reading is
 * recorded pending, and approving it stays on the web, because a POS cannot
 * correct one afterwards.
 */
export class MobilePumpIndexService {
  private readings: PumpIndexRepository;

  constructor(
    private db: PrismaClient,
    private pinSecret: string,
    /** How long after a shift's hours its counters may still be recorded. */
    private graceMinutes: number,
  ) {
    this.readings = new PumpIndexRepository(db);
  }

  /** The attendant behind a phone and PIN, at the device's own site. */
  private attendant(input: MobileAttendantInput, siteId: string) {
    return attendantBy(this.db, input.phone, input.pin, siteId, this.pinSecret);
  }

  /**
   * What this attendant may read right now: the shifts the time table has them
   * working — their hours, or within the grace that follows — and under each
   * one the pumps and nozzles the rota gives them that day, every nozzle with
   * the figure it opens at and whatever reading it already carries.
   *
   * Several shifts can come back at once: minutes after a handover the shift
   * just ended is still within its grace while the next has begun, and the POS
   * has to say which one it is closing.
   */
  async current(input: MobileAttendantInput, siteId: string, now = new Date()) {
    const userId = await this.attendant(input, siteId);
    const { clock, working } = await rosteredNow(this.db, userId, siteId, now, this.graceMinutes);
    if (working.length === 0) {
      throw new BusinessError("ATTENDANT_NOT_ON_SHIFT",
        `You are not on the time table for a shift running now (${clock})`);
    }

    const shifts = [];
    for (const roster of working) {
      const rota = await this.readings.rotaFor(roster.id);
      const dateOn = fromDate(roster.dateOn);
      const nozzleIds = rota.flatMap((row) => row.pumpAttendantNozzles.map(({ nozzle }) => nozzle.id));
      const [openings, recorded] = await Promise.all([
        this.readings.openingFor(nozzleIds),
        nozzleIds.length ? this.readings.recordedFor(nozzleIds, roster.siteShiftId, dateOn) : [],
      ]);
      const openingOf = new Map(openings.map((row) => [row.nozzleId, row.previous]));
      const readingOf = new Map(recorded.map((row) => [row.nozzleId, row]));

      const pumps = [];
      for (const row of rota) {
        const nozzles = [];
        for (const { nozzle } of row.pumpAttendantNozzles) {
          const previous = openingOf.get(nozzle.id) ?? null;
          const reading = readingOf.get(nozzle.id);
          const price = await this.readings.priceFor(nozzle.cuve.item).catch(() => null);
          nozzles.push({
            id: nozzle.id, name: nozzle.name, nozzleCode: nozzle.nozzleCode,
            item: { id: nozzle.cuve.item.id, name: nozzle.cuve.item.name },
            /**
             * What a reading here opens at: the close of the nozzle's last one.
             * A nozzle with none opens at **0** — the opening is never typed at
             * the pump, so no reading can start the chain on a mistyped figure.
             */
            startIndex: previous ? Number(previous.endIndex) : 0,
            isFirst: previous === null,
            /** Already recorded for this shift and day; there is only ever one. */
            reading: reading && {
              id: reading.id,
              startIndex: Number(reading.startIndex),
              endIndex: Number(reading.endIndex),
              approved: reading.confirmedBy !== null,
              attendant: reading.attendant,
            },
            sellingPrice: price === null ? null : Number(price),
          });
        }
        pumps.push({ id: row.pump.id, name: row.pump.name, nozzles });
      }

      shifts.push({
        shiftSiteId: roster.siteShiftId,
        shift: {
          name: roster.shiftSite.shift.name,
          startAt: fromTime(roster.shiftSite.shift.startAt),
          endAt: fromTime(roster.shiftSite.shift.endAt),
        },
        /** The working day the readings count towards — a night shift's own date. */
        workingDay: dateOn,
        /**
         * The shift's own hours are over and only the grace is holding it
         * open — so the POS can lead with "close the shift" rather than
         * offering it as the one being worked.
         */
        closing: ended(fromTime(roster.shiftSite.shift.startAt), fromTime(roster.shiftSite.shift.endAt), clock),
        pumps,
      });
    }

    return { attendant: { id: userId }, clock, graceMinutes: this.graceMinutes, shifts };
  }

  /**
   * Records the counters of one shift, all of them together or none at all.
   *
   * Every nozzle is checked against the rota of that rostered day, so a POS
   * cannot write a reading for equipment that was not this attendant's. The
   * opening figure is carried from the nozzle's last reading — 0 for its
   * first — and the price is a snapshot of the one in force.
   *
   * Nozzles that already carry a reading for the shift are **reported, not
   * refused**: the attendant may well be finishing a submit that half
   * succeeded, and failing the lot would leave them unable to record the rest.
   */
  async record(input: RecordPumpIndexesInput, siteId: string, now = new Date()) {
    const userId = await this.attendant(input, siteId);
    const { clock, working } = await rosteredNow(this.db, userId, siteId, now, this.graceMinutes);
    const roster = working.find((row) => row.siteShiftId === input.shiftSiteId);
    if (!roster) {
      throw new BusinessError("ATTENDANT_NOT_ON_SHIFT",
        `You are not on the time table for that shift now (${clock})`);
    }
    const dateOn = fromDate(roster.dateOn);

    // The nozzles that are theirs on that rostered day, with their pumps.
    const rota = await this.readings.rotaFor(roster.id);
    const theirs = new Map(rota.flatMap((row) =>
      row.pumpAttendantNozzles.map(({ nozzle }) => [nozzle.id, { nozzle, pump: row.pump }] as const)));

    const wanted = [...new Map(input.readings.map((row) => [row.nozzleId, row])).values()];
    const foreign = wanted.filter((row) => !theirs.has(row.nozzleId));
    if (foreign.length > 0) {
      throw new BusinessError("ATTENDANT_NOT_ON_NOZZLE",
        foreign.length === 1
          ? "A nozzle sent is not one of yours on this shift"
          : `${foreign.length} of the nozzles sent are not yours on this shift`,
        422, { nozzleIds: foreign.map((row) => row.nozzleId) });
    }

    const already = await this.readings.recordedFor(wanted.map((row) => row.nozzleId), input.shiftSiteId, dateOn);
    const done = new Set(already.map((row) => row.nozzleId));
    const toWrite = wanted.filter((row) => !done.has(row.nozzleId));
    if (toWrite.length === 0) {
      throw new BusinessError("READING_ALREADY_RECORDED",
        "Every nozzle sent already has a reading for this shift", 409,
        { nozzleIds: [...done] });
    }

    const rows: NewReading[] = [];
    for (const entry of toWrite) {
      const { nozzle, pump } = theirs.get(entry.nozzleId)!;
      const previous = await this.readings.latestFor(nozzle.id);
      // 0 for a nozzle's first reading: never typed at the pump.
      const startIndex = previous ? previous.endIndex : new Prisma.Decimal(0);
      const endIndex = money(entry.endIndex);
      if (endIndex.lessThan(startIndex)) {
        throw new BusinessError("INDEX_GOES_BACKWARDS",
          `${nozzle.name} opens at ${startIndex.toFixed(2)}, so it cannot close at ${endIndex.toFixed(2)}`);
      }
      const price = await this.readings.priceFor(nozzle.cuve.item);
      rows.push({
        nozzle: { id: nozzle.id, pump: { id: pump.id, siteId }, cuve: { item: { id: nozzle.cuve.item.id } } },
        shiftSiteId: input.shiftSiteId,
        dateOn,
        attendantId: userId,
        startIndex,
        endIndex,
        sellingPrice: money(price.toString()),
        createdBy: userId,
      });
    }

    const written = await this.readings.createBatch(rows);
    return {
      /** What was written, with the litres and what they came to. */
      recorded: written.map(presentPumpIndex),
      /** Nozzles that already carried a reading for this shift, left as they were. */
      alreadyRecorded: already.map((row) => ({
        nozzleId: row.nozzleId, endIndex: Number(row.endIndex),
        attendant: row.attendant, approved: row.confirmedBy !== null,
      })),
      /** Approving stays on the web: a POS cannot correct a reading. */
      pending: true,
    };
  }
}
