/**
 * Writes out the dated pump rota that `20261030160000_pump_rota_by_day` needs.
 *
 * The rota used to hold one row per attendant, shift and pump, with no date at
 * all. It now hangs off the roster row (`TblTimeTable`), so each of those rows
 * becomes **one row per day the person is rostered on that shift** — from
 * today forward, so tomorrow's sales and readings keep working while nothing is
 * asserted about last month.
 *
 * Raw SQL throughout: while the migration is half-applied the table has both
 * the old columns and `timeTableId`, which the generated client cannot
 * describe.
 *
 *   pnpm rota:dates                      # what it would write, and what it cannot
 *   pnpm rota:dates --apply              # writes them, then removes the undated rows
 *   pnpm rota:dates --apply --from 2026-11-02   # from another day instead of today
 *   pnpm rota:dates --apply --discard-unplaced  # drops the rows nobody is rostered for
 */
import { PrismaClient } from "../prisma/generated/prisma/client.js";

const db = new PrismaClient();

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

/** Today by the server's clock, as a DATE literal. */
function today() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type Undated = {
  id: string;
  pumpId: string;
  pumpName: string | null;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  siteShiftId: string;
  shiftName: string | null;
  siteName: string | null;
  nozzles: number;
  /** How many rostered days from `from` onward this row will be written to. */
  days: number;
};

async function columns() {
  const rows = await db.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TblPumpAttendant'`,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

/** The undated rows, with the rostered days each one is about to become. */
function undated(from: string) {
  return db.$queryRawUnsafe<Undated[]>(`
    SELECT
      a.id, a.pumpId, p.name AS pumpName,
      a.userId, u.firstName, u.lastName,
      a.siteShiftId, s.name AS shiftName, site.name AS siteName,
      (SELECT COUNT(*) FROM PumpAttendantNozzle n WHERE n.pumpAttendantId = a.id) AS nozzles,
      (
        SELECT COUNT(*) FROM TblTimeTable t
        WHERE t.userId = a.userId AND t.siteShiftId = a.siteShiftId AND t.dateOn >= ?
      ) AS days
    FROM TblPumpAttendant a
    LEFT JOIN TblPump p ON p.id = a.pumpId
    LEFT JOIN User u ON u.id = a.userId
    LEFT JOIN TblShiftSite ss ON ss.id = a.siteShiftId
    LEFT JOIN TblShift s ON s.id = ss.shiftId
    LEFT JOIN TblSite site ON site.id = a.siteId
    WHERE a.timeTableId IS NULL
    ORDER BY site.name, s.name, u.firstName
  `, from);
}

/**
 * One dated row per rostered day, with the same pump and the same nozzles.
 *
 * The new row's id is derived from the roster row and the pump, so running
 * this again writes the same ids and the insert is ignored rather than
 * doubled — and the nozzle copy can find its parent without a mapping table.
 */
async function place(from: string) {
  const written = await db.$executeRawUnsafe(`
    INSERT IGNORE INTO TblPumpAttendant (id, pumpId, siteShiftId, userId, siteId, timeTableId, createdAt)
    SELECT
      LOWER(CONCAT(
        SUBSTRING(SHA2(CONCAT(t.id, ':', a.pumpId), 256), 1, 8), '-',
        SUBSTRING(SHA2(CONCAT(t.id, ':', a.pumpId), 256), 9, 4), '-',
        SUBSTRING(SHA2(CONCAT(t.id, ':', a.pumpId), 256), 13, 4), '-',
        SUBSTRING(SHA2(CONCAT(t.id, ':', a.pumpId), 256), 17, 4), '-',
        SUBSTRING(SHA2(CONCAT(t.id, ':', a.pumpId), 256), 21, 12)
      )),
      a.pumpId, a.siteShiftId, a.userId, a.siteId, t.id, a.createdAt
    FROM TblPumpAttendant a
    JOIN TblTimeTable t ON t.userId = a.userId AND t.siteShiftId = a.siteShiftId AND t.dateOn >= ?
    WHERE a.timeTableId IS NULL
  `, from);

  // The nozzles of the row each dated row came from.
  const nozzles = await db.$executeRawUnsafe(`
    INSERT IGNORE INTO PumpAttendantNozzle (id, pumpAttendantId, nozzleId, createdAt)
    SELECT
      LOWER(CONCAT(
        SUBSTRING(SHA2(CONCAT(dated.id, ':', n.nozzleId), 256), 1, 8), '-',
        SUBSTRING(SHA2(CONCAT(dated.id, ':', n.nozzleId), 256), 9, 4), '-',
        SUBSTRING(SHA2(CONCAT(dated.id, ':', n.nozzleId), 256), 13, 4), '-',
        SUBSTRING(SHA2(CONCAT(dated.id, ':', n.nozzleId), 256), 17, 4), '-',
        SUBSTRING(SHA2(CONCAT(dated.id, ':', n.nozzleId), 256), 21, 12)
      )),
      dated.id, n.nozzleId, n.createdAt
    FROM TblPumpAttendant dated
    JOIN TblPumpAttendant old
      ON old.timeTableId IS NULL AND old.userId = dated.userId
     AND old.siteShiftId = dated.siteShiftId AND old.pumpId = dated.pumpId
    JOIN PumpAttendantNozzle n ON n.pumpAttendantId = old.id
    WHERE dated.timeTableId IS NOT NULL
  `);

  // The undated rows that have become dated ones are done with. Joined, not
  // `EXISTS`: MySQL will not have the table being deleted from named again in
  // a subquery (error 1093), but a self-join in a multi-table DELETE is fine.
  const nozzlesRemoved = await db.$executeRawUnsafe(`
    DELETE n FROM PumpAttendantNozzle n
    JOIN TblPumpAttendant old ON old.id = n.pumpAttendantId AND old.timeTableId IS NULL
    JOIN TblPumpAttendant dated
      ON dated.timeTableId IS NOT NULL AND dated.userId = old.userId
     AND dated.siteShiftId = old.siteShiftId AND dated.pumpId = old.pumpId
  `);
  const removed = await db.$executeRawUnsafe(`
    DELETE old FROM TblPumpAttendant old
    JOIN TblPumpAttendant dated
      ON dated.timeTableId IS NOT NULL AND dated.userId = old.userId
     AND dated.siteShiftId = old.siteShiftId AND dated.pumpId = old.pumpId
    WHERE old.timeTableId IS NULL
  `);
  return { written, nozzles, removed, nozzlesRemoved };
}

/** Drops the undated rows nobody is rostered for, once they have been reported. */
async function discard() {
  const nozzles = await db.$executeRawUnsafe(`
    DELETE n FROM PumpAttendantNozzle n
    JOIN TblPumpAttendant a ON a.id = n.pumpAttendantId
    WHERE a.timeTableId IS NULL
  `);
  const rows = await db.$executeRawUnsafe("DELETE FROM TblPumpAttendant WHERE timeTableId IS NULL");
  return { rows, nozzles };
}

const person = (row: Undated) => `${row.firstName ?? "?"} ${row.lastName ?? ""}`.trim();

async function main() {
  const present = await columns();
  if (!present.has("timeTableId")) {
    console.log("`TblPumpAttendant.timeTableId` does not exist yet: run `npx prisma migrate deploy` first.");
    return;
  }
  if (!present.has("userId")) {
    console.log("The old columns are gone, so the rota is already dated. Nothing to place.");
    return;
  }

  const from = valueOf("--from") ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`--from must be a date like 2026-11-02, not "${from}"`);

  if (has("--apply")) {
    const { written, nozzles, removed, nozzlesRemoved } = await place(from);
    console.log(`Wrote ${written} dated assignment(s) with ${nozzles} nozzle link(s),`
      + ` and removed ${removed} undated row(s) (${nozzlesRemoved} nozzle links) now covered by them.\n`);
  }

  const rows = await undated(from);
  const placeable = rows.filter((row) => Number(row.days) > 0);
  const unplaced = rows.filter((row) => Number(row.days) === 0);

  if (rows.length === 0) {
    console.log("Every pump assignment carries its rostered day.");
  } else {
    console.log(`${rows.length} undated assignment(s) left, counting rostered days from ${from}.\n`);
    for (const [title, group] of [
      ["Ready to write: the attendant is rostered on that shift", placeable],
      ["Nobody rostered: there is no day to put these on", unplaced],
    ] as const) {
      if (group.length === 0) continue;
      console.log(`── ${title} ──`);
      for (const row of group) {
        console.log(`  ${person(row)} · ${row.shiftName ?? "?"} · ${row.pumpName ?? "?"}`
          + ` · ${row.nozzles} nozzle(s) · ${row.siteName ?? "?"}`
          + (Number(row.days) > 0 ? ` → ${row.days} day(s)` : ""));
      }
      console.log("");
    }
  }

  if (has("--discard-unplaced")) {
    if (unplaced.length === 0) {
      console.log("Nothing to discard: every row left can be placed.");
    } else {
      const { rows: dropped, nozzles } = await discard();
      console.log(`Discarded ${dropped} assignment(s) and ${nozzles} nozzle link(s) that no roster day covered.`);
      console.log("Re-enter them on the Shifts page once those days are rostered.");
    }
  }

  // `undated`, not `left`: MySQL reserves that word.
  const [{ undated: remaining }] = await db.$queryRawUnsafe<Array<{ undated: bigint }>>(
    "SELECT COUNT(*) AS undated FROM TblPumpAttendant WHERE timeTableId IS NULL");
  if (Number(remaining) > 0) {
    console.log(`\n${remaining} row(s) still undated, so the second migration will refuse to finish.`);
    console.log("Roster those people (Shifts → Time table) and run `pnpm rota:dates --apply` again,");
    console.log("or drop them with `pnpm rota:dates --discard-unplaced`.");
  } else {
    console.log("\nEvery row is dated. Finish with:\n  npx prisma migrate deploy");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
