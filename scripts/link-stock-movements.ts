/**
 * Attributes the stock movements written before `StockTransaction.drawId`
 * existed to the draw that caused them.
 *
 * Every `saleOut` used to be written with nothing but the batch and the type on
 * it, so a movement could not be told apart from its neighbours' on the same
 * batch. That is what let an edit rewrite them all. New movements carry their
 * `drawId`; these are the old ones.
 *
 * It only links what it can prove. For each central stock batch, the draws and
 * the unattributed `saleOut` rows on it are paired **only where the quantity
 * matches exactly, one draw to one movement**. Where two draws on a batch share
 * a quantity, or the counts do not line up, the batch is reported and left
 * alone — a wrong link is worse than no link, because it would let a later edit
 * move the wrong figure.
 *
 *   pnpm stock:link-movements            # the report: what it would link, what it cannot
 *   pnpm stock:link-movements --apply    # writes the links
 */
import { PrismaClient } from "../prisma/generated/prisma/client.js";

const db = new PrismaClient();
const apply = process.argv.slice(2).includes("--apply");

type Row = { id: string; centralStockId: string; quantity: string };

const draws = await db.$queryRaw<Row[]>`
  SELECT o.id, o.centralStockId, CAST(o.quantity AS CHAR) AS quantity
  FROM \`CentralStockOrder\` o
  WHERE NOT EXISTS (
    SELECT 1 FROM \`StockTransaction\` t WHERE t.drawId = o.id AND t.type = 'saleOut'
  )
  ORDER BY o.centralStockId, o.createdAt
`;
const movements = await db.$queryRaw<Row[]>`
  SELECT t.id, t.centralStockId, CAST(t.quantity AS CHAR) AS quantity
  FROM \`StockTransaction\` t
  WHERE t.type = 'saleOut' AND t.drawId IS NULL
  ORDER BY t.centralStockId, t.createdAt
`;

const by = <T extends { centralStockId: string }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  for (const row of rows) (map.get(row.centralStockId) ?? map.set(row.centralStockId, []).get(row.centralStockId)!).push(row);
  return map;
};
const drawsByStock = by(draws);
const movementsByStock = by(movements);

const links: Array<{ drawId: string; movementId: string; quantity: string }> = [];
const skipped: Array<{ centralStockId: string; why: string }> = [];

for (const [centralStockId, stockDraws] of drawsByStock) {
  const stockMovements = movementsByStock.get(centralStockId) ?? [];
  if (stockMovements.length === 0) {
    skipped.push({ centralStockId, why: `${stockDraws.length} draw(s), no unattributed movement` });
    continue;
  }
  // Count how many draws and movements share each quantity on this batch. Only
  // a quantity with exactly one of each is unambiguous.
  const count = (rows: Row[]) =>
    rows.reduce((map, row) => map.set(row.quantity, [...(map.get(row.quantity) ?? []), row]),
      new Map<string, Row[]>());
  const drawsByQuantity = count(stockDraws);
  const movementsByQuantity = count(stockMovements);

  for (const [quantity, matchingDraws] of drawsByQuantity) {
    const matchingMovements = movementsByQuantity.get(quantity) ?? [];
    if (matchingDraws.length === 1 && matchingMovements.length === 1) {
      links.push({ drawId: matchingDraws[0]!.id, movementId: matchingMovements[0]!.id, quantity });
    } else {
      skipped.push({
        centralStockId,
        why: `quantity ${quantity}: ${matchingDraws.length} draw(s) and ` +
          `${matchingMovements.length} movement(s) — cannot be told apart`,
      });
    }
  }
}

console.log(`draws with no linked movement : ${draws.length}`);
console.log(`unattributed saleOut movements: ${movements.length}`);
console.log(`unambiguous links             : ${links.length}`);
console.log(`left alone                    : ${skipped.length} case(s)`);
for (const row of skipped.slice(0, 20)) console.log(`  · ${row.centralStockId}  ${row.why}`);
if (skipped.length > 20) console.log(`  … and ${skipped.length - 20} more`);

if (!apply) {
  console.log("\nNothing written. Re-run with --apply once the report above looks right.");
} else {
  let written = 0;
  for (const link of links) {
    await db.$executeRaw`UPDATE \`StockTransaction\` SET drawId = ${link.drawId} WHERE id = ${link.movementId}`;
    written += 1;
  }
  console.log(`\nLinked ${written} movement(s).`);
  console.log(
    "The cases left alone keep `drawId` empty. Editing one of those requests is " +
      "refused with an explanation rather than applied to the wrong row.",
  );
}

await db.$disconnect();
