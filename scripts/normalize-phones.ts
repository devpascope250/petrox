/**
 * Rewrites the phone numbers already in the database into the one shape
 * `phoneSchema` now stores them in, so `User.phone`'s unique index — and the
 * POS sign-in, which looks an attendant up by the number they type — see the
 * same number as the same text.
 *
 *     pnpm phones:normalize            # reports what it would change
 *     pnpm phones:normalize --apply    # writes the changes
 *
 * Two users whose numbers turn out to be the same are left untouched and
 * listed: one of them has to be corrected by hand first.
 */
import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { phoneSchema } from "../src/shared/validation/index.js";

const apply = process.argv.includes("--apply");

async function main() {
  const db = new PrismaClient();
  try {
    const users = await db.user.findMany({
      where: { phone: { not: null } },
      select: { id: true, email: true, phone: true },
      orderBy: { createdAt: "asc" },
    });

    const taken = new Map<string, string>();
    const changes: { id: string; email: string; from: string; to: string }[] = [];
    const clashes: { email: string; phone: string; with: string }[] = [];

    for (const user of users) {
      const parsed = phoneSchema.safeParse(user.phone!);
      // A number the schema itself would refuse is left for a person to fix.
      const normalized = parsed.success ? parsed.data : user.phone!;
      const holder = taken.get(normalized);
      if (holder) {
        clashes.push({ email: user.email, phone: user.phone!, with: holder });
        continue;
      }
      taken.set(normalized, user.email);
      if (normalized !== user.phone) {
        changes.push({ id: user.id, email: user.email, from: user.phone!, to: normalized });
      }
    }

    console.log(`${users.length} user(s) with a phone number.`);
    for (const change of changes) console.log(`  ${change.email}: ${change.from} -> ${change.to}`);
    for (const clash of clashes) {
      console.log(`  ! ${clash.email}: ${clash.phone} is the same number as ${clash.with}'s — fix one by hand`);
    }
    if (!changes.length) console.log("Nothing to change.");

    if (!apply) {
      console.log(changes.length ? "Nothing written. Run with --apply to write these." : "");
      return;
    }
    for (const change of changes) {
      await db.user.update({ where: { id: change.id }, data: { phone: change.to } });
    }
    console.log(`${changes.length} number(s) rewritten.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
