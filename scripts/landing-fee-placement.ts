/**
 * Places the landing fees that `20261028120000_fees_on_central_stock` could
 * not move on its own.
 *
 * `ChainStockFee` used to hang off a depot stock receipt (`Stock`); it now
 * hangs off the central stock receipt the load was received into
 * (`CentralStock`). The migration moves a charge whose stock reaches **exactly
 * one** receipt, and stops rather than guess about the rest:
 *
 * - **ambiguous** — the stock was loaded by several nominations, so several
 *   receipts came out of it, and only a person knows which bore the cost (or
 *   whether it should be split);
 * - **not yet received** — the stock has no central stock receipt at all,
 *   because the fee was charged when the load arrived at the depot, before it
 *   was received centrally. There is nowhere to put it yet.
 *
 * Raw SQL throughout: while the migration is half-applied the table has both
 * `stockId` and `centralStockId`, which the generated client cannot describe.
 *
 *   npx tsx --env-file=.env scripts/landing-fee-placement.ts
 *   npx tsx --env-file=.env scripts/landing-fee-placement.ts --place-earliest
 *   npx tsx --env-file=.env scripts/landing-fee-placement.ts --export fees.json
 *   npx tsx --env-file=.env scripts/landing-fee-placement.ts --export fees.json --discard
 */
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "../prisma/generated/prisma/client.js";

const db = new PrismaClient();

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

type Unplaced = {
  id: string;
  name: string;
  count: number;
  unitAmount: string;
  currencyCode: string;
  createdAt: Date;
  stockId: string;
  stockQuantity: string;
  stockStatus: string;
  itemName: string | null;
  depotName: string | null;
  vesselName: string | null;
  blRef: string | null;
  receiptCount: number;
  receiptIds: string | null;
};

async function columns() {
  const rows = await db.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ChainStockFee'`,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

/**
 * Every charge still unplaced, with the stock it was charged against and the
 * central stock receipts that stock led to — none, or several.
 */
function unplaced() {
  return db.$queryRawUnsafe<Unplaced[]>(`
    SELECT
      fee.id, fee.name, fee.count, fee.unitAmount, fee.currencyCode, fee.createdAt,
      fee.stockId,
      s.quantity AS stockQuantity, s.status AS stockStatus,
      i.name AS itemName, d.name AS depotName,
      c.vesselName, c.blRef,
      (
        SELECT COUNT(DISTINCT cs.id)
        FROM NominationVessel nv
        JOIN T1Validation t1 ON t1.nominationId = nv.nominationId
        JOIN CentralStock cs ON cs.t1ValidationId = t1.id
        WHERE nv.stockId = fee.stockId
      ) AS receiptCount,
      (
        SELECT GROUP_CONCAT(DISTINCT cs.id ORDER BY cs.createdAt)
        FROM NominationVessel nv
        JOIN T1Validation t1 ON t1.nominationId = nv.nominationId
        JOIN CentralStock cs ON cs.t1ValidationId = t1.id
        WHERE nv.stockId = fee.stockId
      ) AS receiptIds
    FROM ChainStockFee fee
    JOIN Stock s ON s.id = fee.stockId
    LEFT JOIN Item i ON i.id = s.itemId
    LEFT JOIN Deport d ON d.id = s.deportId
    LEFT JOIN Cargo c ON c.id = s.cargoId
    WHERE fee.centralStockId IS NULL
    ORDER BY fee.createdAt
  `);
}

/**
 * Places every ambiguous charge on the **earliest** receipt its stock led to.
 *
 * Defensible when a load went out on several trips: the cost of landing it was
 * incurred once, at the first receipt, and putting it on each would overstate
 * it. Charges whose stock has no receipt at all are left alone — there is
 * nothing to place them on.
 */
async function placeEarliest() {
  const moved = await db.$executeRawUnsafe(`
    UPDATE ChainStockFee AS fee
    SET centralStockId = (
      SELECT cs.id
      FROM NominationVessel nv
      JOIN T1Validation t1 ON t1.nominationId = nv.nominationId
      JOIN CentralStock cs ON cs.t1ValidationId = t1.id
      WHERE nv.stockId = fee.stockId
      ORDER BY cs.createdAt, cs.id
      LIMIT 1
    )
    WHERE fee.centralStockId IS NULL
      AND EXISTS (
        SELECT 1
        FROM NominationVessel nv
        JOIN T1Validation t1 ON t1.nominationId = nv.nominationId
        JOIN CentralStock cs ON cs.t1ValidationId = t1.id
        WHERE nv.stockId = fee.stockId
      )
  `);
  return moved;
}

/**
 * Two charges of the same fee landing on one receipt would break the unique
 * key the migration adds, so they are reported before it is run again.
 */
function clashes() {
  // `charges`, not `rows`: MySQL 8 reserves that word.
  return db.$queryRawUnsafe<Array<{ centralStockId: string; feeTypeId: string; charges: bigint }>>(`
    SELECT centralStockId, feeTypeId, COUNT(*) AS charges
    FROM ChainStockFee
    WHERE centralStockId IS NOT NULL
    GROUP BY centralStockId, feeTypeId
    HAVING COUNT(*) > 1
  `);
}

const money = (value: string) => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2 });

async function main() {
  const present = await columns();
  if (!present.has("stockId")) {
    console.log("`ChainStockFee.stockId` is gone, so the migration has already finished here.");
    console.log("Nothing to place.");
    return;
  }
  if (!present.has("centralStockId")) {
    console.log("`ChainStockFee.centralStockId` does not exist yet: run `npx prisma migrate deploy` first,");
    console.log("then this script if it stops at the guard.");
    return;
  }

  if (has("--place-earliest")) {
    const moved = await placeEarliest();
    console.log(`Placed ${moved} charge(s) on the earliest receipt of their stock.\n`);
  }

  const rows = await unplaced();
  const ambiguous = rows.filter((row) => Number(row.receiptCount) > 1);
  const notReceived = rows.filter((row) => Number(row.receiptCount) === 0);

  console.log(`${rows.length} landing fee(s) still unplaced`
    + ` — ${ambiguous.length} ambiguous, ${notReceived.length} not received centrally yet.\n`);

  for (const [title, group] of [
    ["Ambiguous: the stock led to several central stock receipts", ambiguous],
    ["Not received centrally: the stock has no receipt to charge", notReceived],
  ] as const) {
    if (group.length === 0) continue;
    console.log(`── ${title} ──`);
    for (const row of group) {
      console.log(
        `  ${row.name} · ${money(row.unitAmount)} ${row.currencyCode} × ${row.count}`
        + ` · charged ${row.createdAt.toISOString().slice(0, 10)}`,
      );
      console.log(
        `    stock ${row.stockId} · ${row.itemName ?? "?"} · ${money(row.stockQuantity)} · ${row.stockStatus}`
        + ` · ${row.depotName ?? "?"}${row.vesselName ? ` · ${row.vesselName}` : ""}${row.blRef ? ` · BL ${row.blRef}` : ""}`,
      );
      if (row.receiptIds) console.log(`    receipts: ${row.receiptIds.split(",").join(", ")}`);
    }
    console.log("");
  }

  const clashing = await clashes();
  if (clashing.length > 0) {
    console.log("⚠ Two charges of the same fee have landed on one receipt, which the new unique key");
    console.log("  forbids. Merge or remove one of each pair before running the migration again:");
    for (const row of clashing) {
      console.log(`    receipt ${row.centralStockId} · fee type ${row.feeTypeId} · ${row.charges} charges`);
    }
    console.log("");
  }

  const path = valueOf("--export");
  if (path) {
    await writeFile(path, JSON.stringify(rows, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value, 2));
    console.log(`Wrote ${rows.length} unplaced charge(s) to ${path}.`);
  }

  if (has("--discard")) {
    if (!path) {
      console.log("Refusing to discard without `--export <file>` in the same run: export them first,");
      console.log("so the figures can be re-entered against the receipt once the stock is received.");
      return;
    }
    const ids = rows.map((row) => `'${row.id}'`).join(",");
    const removed = ids
      ? await db.$executeRawUnsafe(`DELETE FROM ChainStockFee WHERE id IN (${ids})`)
      : 0;
    console.log(`Discarded ${removed} charge(s). They are in ${path}; re-enter them against the`);
    console.log("central stock receipt once the load is received.");
  }

  if (rows.length > 0 && !has("--discard")) {
    console.log("Next: place them (`--place-earliest`), or export and discard them");
    console.log("(`--export fees.json --discard`), then:");
    console.log('  npx prisma migrate resolve --rolled-back "20261028120000_fees_on_central_stock"');
    console.log("  npx prisma migrate deploy");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
