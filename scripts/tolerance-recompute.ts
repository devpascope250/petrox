/**
 * Recomputes the loss, gain and allowance on central stock receipts.
 *
 * The three columns used to be whatever the receiving form sent, and were
 * optional, so a receipt could carry a figure nobody checked or none at all.
 * They are now worked out from the two quantities at 20 °C — what the T1
 * cleared against what was taken in — so the transporter tolerance report and
 * the receipts themselves can never disagree.
 *
 * This brings the receipts already recorded onto the same footing. It reports
 * before it writes, and names every receipt whose stored figure disagreed with
 * its own quantities, since that is worth looking at before it is overwritten.
 *
 *   pnpm tolerance:recompute           # what it would change
 *   pnpm tolerance:recompute --apply   # change it
 */
import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { allowedToleranceRate, toleranceFor } from "../src/modules/central-stock/tolerance-rules.js";

const db = new PrismaClient();
const apply = process.argv.includes("--apply");

const two = (value: { toFixed: (digits: number) => string } | null) => value === null ? "—" : value.toFixed(2);

async function main() {
  const receipts = await db.centralStock.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNumber: true, itemId: true, quantityAt20C: true,
      lossQty: true, gainQty: true, toleranceRate: true, createdAt: true,
      item: { select: { name: true } },
      deport: { select: { name: true } },
      t1Validation: {
        select: {
          quantityAt20C: true,
          nomination: { select: { driverVehicle: { select: {
            vechile: { select: { platNumber: true, transport: { select: { name: true } } } } } } } },
        },
      },
    },
  });

  if (receipts.length === 0) {
    console.log("No central stock receipts yet, so there is nothing to recompute.");
    return;
  }

  // One rate lookup per product, not per receipt.
  const rates = new Map<string, Awaited<ReturnType<typeof allowedToleranceRate>>>();
  for (const itemId of new Set(receipts.map((row) => row.itemId))) {
    rates.set(itemId, await allowedToleranceRate(db, itemId));
  }

  let changed = 0;
  let disagreed = 0;
  let unjudged = 0;
  for (const receipt of receipts) {
    const tolerance = toleranceFor({
      t1Quantity: receipt.t1Validation.quantityAt20C,
      receivedQuantity: receipt.quantityAt20C,
      allowedRate: rates.get(receipt.itemId) ?? null,
    });
    const was = { loss: receipt.lossQty, gain: receipt.gainQty, rate: receipt.toleranceRate };
    const same = (left: { equals: (right: never) => boolean } | null, right: unknown) =>
      left === null ? right === null : right !== null && left.equals(right as never);
    const unchanged = same(was.loss, tolerance.lossQty) && same(was.gain, tolerance.gainQty)
      && same(was.rate, tolerance.allowedRate);
    if (tolerance.allowedRate === null) unjudged += 1;
    if (unchanged) continue;
    changed += 1;

    const transporter = receipt.t1Validation.nomination.driverVehicle.vechile.transport.name;
    const plate = receipt.t1Validation.nomination.driverVehicle.vechile.platNumber;
    // A stored figure that disagrees with the quantities is the interesting
    // case: somebody typed something the load does not bear out.
    const typedSomething = was.loss !== null || was.gain !== null;
    if (typedSomething && (!same(was.loss, tolerance.lossQty) || !same(was.gain, tolerance.gainQty))) {
      disagreed += 1;
    }
    console.log(
      `  ${receipt.createdAt.toISOString().slice(0, 10)} · ${receipt.receiptNumber ?? receipt.id.slice(0, 8)}`
      + ` · ${receipt.item.name} · ${receipt.deport.name} · ${transporter} (${plate})`);
    console.log(
      `      T1 ${two(receipt.t1Validation.quantityAt20C)} → received ${two(receipt.quantityAt20C)}`
      + ` · loss ${two(was.loss)} → ${two(tolerance.lossQty)}`
      + ` · gain ${two(was.gain)} → ${two(tolerance.gainQty)}`
      + ` · allowed ${two(was.rate)} → ${two(tolerance.allowedRate)}%`);

    if (apply) {
      await db.centralStock.update({
        where: { id: receipt.id },
        data: { lossQty: tolerance.lossQty, gainQty: tolerance.gainQty, toleranceRate: tolerance.allowedRate },
      });
    }
  }

  console.log(`\n${receipts.length} receipt(s) read, ${changed} ${apply ? "changed" : "to change"}`
    + `${disagreed > 0 ? `, ${disagreed} of them carrying a typed figure the quantities did not bear out` : ""}.`);
  if (unjudged > 0) {
    console.log(`${unjudged} receipt(s) are for a product with no tolerance rate set, so they count`);
    console.log("their litres but stand outside the judgement. Set the rate under Items → Tolerance rates.");
  }
  if (!apply && changed > 0) console.log("\nNothing was written. Run it again with --apply.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
