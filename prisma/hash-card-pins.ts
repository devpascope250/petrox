/**
 * One-off: card PINs used to be stored as digits. This replaces every PIN
 * still stored in clear with its hash (see src/modules/cards/card-pin.ts),
 * leaving the PIN itself unchanged. Already-hashed PINs are left alone, so
 * running it again changes nothing. Run with:
 *   npx tsx prisma/hash-card-pins.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { hashCardPin } from "../src/modules/cards/card-pin.js";

const db = new PrismaClient();
/** What a stored hash looks like: an HMAC-SHA-256 in hex. */
const HASHED = /^[0-9a-f]{64}$/;

async function main() {
  const secret = process.env.PIN_HMAC_SECRET;
  if (!secret || secret.length < 32) throw new Error("PIN_HMAC_SECRET is not set");
  const rows = await db.cardCopy.findMany({ where: { pin: { not: null } }, select: { id: true, pin: true } });
  let hashed = 0;
  for (const row of rows) {
    if (HASHED.test(row.pin!)) continue;
    await db.cardCopy.update({ where: { id: row.id }, data: { pin: hashCardPin(row.pin!, secret) } });
    hashed++;
  }
  console.log(`${hashed} PIN(s) hashed, ${rows.length - hashed} already hashed`);
}

main()
  .catch((error) => {
    console.error("Hashing card PINs failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
