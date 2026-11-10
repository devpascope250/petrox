import { randomUUID } from "node:crypto";
import { Prisma } from "../../../prisma/generated/prisma/client.js";

/** Just enough of a Prisma client to run raw SQL — the caller's transaction. */
type RawClient = {
  $executeRaw(query: Prisma.Sql): Promise<number>;
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
};

export interface DocumentNumberOptions {
  /** The counter's name, e.g. `requisition`. */
  name: string;
  /** What the counter resets on, e.g. the year as `2026`. */
  period: string;
  /** What the number reads as, e.g. `REQ` → `REQ-2026-0001`. */
  prefix: string;
  /** How many digits the running part is padded to. */
  width?: number;
}

/**
 * The next gap-free number for a document, e.g. `REQ-2026-0001`.
 *
 * **Must be called inside the transaction that creates the document**, and the
 * transaction client passed in. That is the whole point: `INSERT … ON DUPLICATE
 * KEY UPDATE value = value + 1` takes an exclusive lock on the counter row and
 * holds it until the transaction commits, so two requests arriving together are
 * serialised and get `0007` and `0008`. Called outside a transaction, or with
 * the number read back separately, the second request can reuse the first's
 * number.
 *
 * Why not `max(number) + 1`: two readers see the same maximum and both write
 * the same number — and the unique index then fails one of them *after* the
 * rest of the document was built. Why not a random code: operations people read
 * these out, chase them and file them in order; `REQ-2026-0042` tells them
 * which came first and that none is missing, which `REQ-A3F19C` cannot.
 *
 * Raw SQL rather than an upsert because the atomicity is the feature here, and
 * an upsert's behaviour depends on whether the client resolves it to one
 * statement or to a read followed by a write.
 */
export async function nextDocumentNumber(
  tx: RawClient,
  { name, period, prefix, width = 4 }: DocumentNumberOptions,
): Promise<string> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO \`NumberSequence\` (\`id\`, \`name\`, \`period\`, \`value\`, \`createdAt\`, \`updatedAt\`)
    VALUES (${randomUUID()}, ${name}, ${period}, 1, NOW(3), NOW(3))
    ON DUPLICATE KEY UPDATE \`value\` = \`value\` + 1, \`updatedAt\` = NOW(3)
  `);

  // Read back inside the same transaction, where the row is still locked.
  const rows = await tx.$queryRaw<{ value: number | bigint }[]>(Prisma.sql`
    SELECT \`value\` FROM \`NumberSequence\` WHERE \`name\` = ${name} AND \`period\` = ${period}
  `);
  const value = Number(rows[0]?.value ?? 1);
  return `${prefix}-${period}-${String(value).padStart(width, "0")}`;
}

/** The year a document raised now belongs to, as the counter's period. */
export function currentPeriod(now = new Date()): string {
  return String(now.getFullYear());
}
