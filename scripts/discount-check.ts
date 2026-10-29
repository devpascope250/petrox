/**
 * Says why a sale is, or is not, getting the discount you expect — and the
 * subsidy beside it, so the two can be read together.
 *
 * A discount and a subsidy are **independent**: a sale records both at once
 * when both apply. Among discounts only one applies, the best for the
 * customer, so a client's own rate and a volume promotion never add together.
 *
 * This prints every discount in the database with the verdict for the sale
 * described, naming the reason each one is out, then the subsidy for the
 * product. Read-only, so it is safe on a live server, and the verdict comes
 * from the sale rules themselves (`discount-rules`, `subsidy-rules`) so it
 * cannot disagree with what a sale would do.
 *
 *   npx tsx --env-file=.env scripts/discount-check.ts
 *   npx tsx --env-file=.env scripts/discount-check.ts --site KIGALI --client C-0007 --quantity 11.34 --price 1764
 *   npx tsx --env-file=.env scripts/discount-check.ts --item AGO --plate "RAD 123 A" --at 2026-10-01
 */
import { Prisma, PrismaClient } from "../prisma/generated/prisma/client.js";
import { bestDiscount, discountsInForce } from "../src/modules/discounts/discount-rules.js";
import { subsidisedCar, subsidyInForce } from "../src/modules/subsidies/subsidy-rules.js";

const db = new PrismaClient();

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

const dec = (value: number | string) => new Prisma.Decimal(value);
const day = (date: Date) => date.toISOString().slice(0, 10);

/** A row found by id, or by a word in its name or code, so a flag can be typed as a name. */
const pickSite = (hint?: string) => hint
  ? db.tblSite.findFirst({ where: { OR: [{ id: hint }, { name: { contains: hint } }] }, select: { id: true, name: true } })
  : db.tblSite.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });

const pickClient = (hint?: string) => hint
  ? db.client.findFirst({
      where: { OR: [{ id: hint }, { clientCode: hint }, { name: { contains: hint } }] },
      select: { id: true, clientCode: true, name: true, subsidyAllowed: true },
    })
  : null;

const pickItem = (hint?: string) => hint
  ? db.item.findFirst({ where: { OR: [{ id: hint }, { name: { contains: hint } }] }, select: { id: true, name: true } })
  : null;

/**
 * Why one discount is out of force for this sale, or `null` when it is in.
 *
 * The same conditions `discountsInForce` filters on, spelled out one at a time
 * so the answer can say which one it was.
 */
function outBecause(
  discount: { status: string; validFrom: Date; validTo: Date; siteId: string | null; clientId: string | null },
  sale: { siteId: string; clientId: string | null; at: Date },
) {
  if (discount.status !== "active") return `switched off (status ${discount.status})`;
  if (discount.validFrom > sale.at) return `not started yet (valid from ${day(discount.validFrom)})`;
  if (discount.validTo < sale.at) return `expired (valid to ${day(discount.validTo)})`;
  if (discount.siteId && discount.siteId !== sale.siteId) return "belongs to another site";
  if (discount.clientId && discount.clientId !== sale.clientId) {
    return sale.clientId ? "belongs to another client" : "is for a client, and this sale has none";
  }
  return null;
}

async function main() {
  const at = valueOf("--at") ? new Date(`${valueOf("--at")}T12:00:00.000Z`) : new Date();
  const site = await pickSite(valueOf("--site"));
  if (!site) {
    console.log(valueOf("--site") ? `No site matches "${valueOf("--site")}".` : "There are no sites.");
    return;
  }
  const client = await pickClient(valueOf("--client"));
  if (valueOf("--client") && !client) return void console.log(`No client matches "${valueOf("--client")}".`);
  const item = await pickItem(valueOf("--item"));
  if (valueOf("--item") && !item) return void console.log(`No product matches "${valueOf("--item")}".`);

  const quantity = dec(valueOf("--quantity") ?? 40);
  const unitPrice = dec(valueOf("--price") ?? 1000);
  const gross = quantity.times(unitPrice).toDecimalPlaces(2);
  const sale = { siteId: site.id, clientId: client?.id ?? null, at };

  console.log(`\nA sale of ${quantity.toString()} at ${unitPrice.toString()} — ${gross.toString()} on the pump`);
  console.log(`  site     ${site.name}  (${site.id})`);
  console.log(`  client   ${client ? `${client.name ?? ""} ${client.clientCode}`.trim() : "none — a walk-in"}`);
  console.log(`  product  ${item ? item.name : "not given — pass --item to check the subsidy"}`);
  console.log(`  on       ${day(at)}`);

  // ---------- discounts ----------
  const all = await db.discount.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, type: true, value: true, status: true, siteId: true, clientId: true,
      validFrom: true, validTo: true,
      site: { select: { name: true } },
      client: { select: { clientCode: true, name: true } },
      rangingDiscounts: { select: { id: true, from: true, to: true, rate: true, status: true, siteId: true } },
    },
  });

  console.log(`\nDISCOUNTS — ${all.length} in the database`);
  if (all.length === 0) console.log("  None at all, so no sale can carry one.");

  for (const row of all) {
    const where = row.site ? row.site.name : "every site";
    const who = row.client ? `${row.client.name ?? ""} ${row.client.clientCode}`.trim() : "everyone";
    const headline = row.type === "fixed" ? `${row.value.toString()}% off` : `${row.rangingDiscounts.length} volume tier(s)`;
    const reason = outBecause(row, sale);
    console.log(`\n  ${reason ? "✗" : "✓"} ${row.type.padEnd(7)} ${headline}`);
    console.log(`      ${day(row.validFrom)} → ${day(row.validTo)}, ${where}, for ${who}, status ${row.status}`);
    if (reason) {
      console.log(`      OUT: ${reason}`);
      continue;
    }

    if (row.type === "ranging") {
      // Tiers are filtered by site and status as well, and the volume has to
      // fall inside one, so a ranging discount can be in force and still give
      // nothing.
      const usable = row.rangingDiscounts.filter((tier) => tier.status === "active" && tier.siteId === site.id);
      if (row.rangingDiscounts.length === 0) console.log("      OUT: it has no tiers at all");
      else if (usable.length === 0) {
        console.log("      OUT: no tier of its own is active at this site");
        for (const tier of row.rangingDiscounts) {
          console.log(`           ${tier.from.toString()}–${tier.to.toString()} at ${tier.rate.toString()}%`
            + ` — status ${tier.status}, site ${tier.siteId === site.id ? "this one" : "another"}`);
        }
      } else {
        const match = usable.filter((tier) =>
          quantity.greaterThanOrEqualTo(tier.from) && quantity.lessThanOrEqualTo(tier.to));
        for (const tier of usable) {
          const hit = match.includes(tier);
          console.log(`      ${hit ? "→" : " "} ${tier.from.toString()}–${tier.to.toString()} at ${tier.rate.toString()}%`
            + `${hit ? "  (this volume)" : ""}`);
        }
        if (match.length === 0) console.log(`      OUT: ${quantity.toString()} falls outside every tier`);
      }
    }
  }

  // What a sale would actually record, straight from the rules.
  const candidates = await discountsInForce(db, sale);
  const best = bestDiscount(candidates, quantity, gross);
  console.log(`\n  ${candidates.length} discount(s) in force here; a sale records ${best ? "one of them" : "none"}.`);
  if (best) {
    console.log(`  → ${best.rate.toString()}% = ${best.amount.toString()} recorded, discount ${best.discountId}`
      + `${best.tier ? ` (tier ${best.tier.from.toString()}–${best.tier.to.toString()})` : ""}`);
    if (candidates.length > 1) console.log("    The others lose: only the best discount applies, never two added together.");
  }

  // ---------- the subsidy beside it ----------
  console.log("\nSUBSIDY");
  if (!item) {
    console.log("  Pass --item to check it.");
  } else {
    const subsidy = await subsidyInForce(db, { itemId: item.id, siteId: site.id, at });
    const everySubsidy = await db.subsidy.findMany({
      where: { itemId: item.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, rate: true, status: true, from: true, to: true, siteId: true, site: { select: { name: true } } },
    });
    console.log(`  ${everySubsidy.length} on ${item.name}:`);
    for (const row of everySubsidy) {
      const live = subsidy?.id === row.id;
      console.log(`    ${live ? "✓" : "✗"} ${row.rate.toString()} a litre, ${day(row.from)} → ${day(row.to)},`
        + ` ${row.site ? row.site.name : "every site"}, status ${row.status}`);
    }
    if (!subsidy) console.log("    None is in force for this site today.");

    const plate = valueOf("--plate");
    const car = await subsidisedCar(db, { itemId: item.id, clientId: sale.clientId, platNumber: plate ?? null });
    if (!client) console.log("  No client, so no car can earn it.");
    else if (!client.subsidyAllowed) console.log(`  ${client.clientCode} is not flagged subsidyAllowed, so nothing is earned.`);
    else if (car) console.log(`  Car ${car.plateNo} is allowed and takes ${item.name}`
      + `${subsidy ? ` → ${quantity.times(subsidy.rate).toDecimalPlaces(2).toString()} recorded` : ""}`);
    else {
      console.log(plate
        ? `  No allowed car of ${client.clientCode} matches ${plate} and takes ${item.name}.`
        : "  Pass --plate to check a particular car.");
      const cars = await db.clientCar.findMany({
        where: { clientId: client.id },
        select: { plateNo: true, status: true, subsidyAllowed: true, item: { select: { name: true } } },
      });
      for (const row of cars) {
        console.log(`    ${row.subsidyAllowed && row.status === "active" && row.item.name === item.name ? "✓" : "✗"}`
          + ` ${row.plateNo} — ${row.item.name}, status ${row.status}, allowed ${row.subsidyAllowed}`);
      }
    }
  }

  console.log("\nBoth can apply to one sale: neither excludes the other, and both are"
    + "\nrecorded against it rather than taken off what the customer pays.\n");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
