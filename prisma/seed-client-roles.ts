/**
 * Grants the client-facing roles the permissions their portal needs.
 *
 * The sidebar at `GET /api/v1/modules/sidebar` is built purely from the caller's
 * role permissions, so a client sees a client menu simply by holding a narrower
 * set than an administrator. Until this runs, the client roles hold nothing and
 * every client login lands on an empty sidebar with 403s behind it.
 *
 * Only permissions whose services scope reads to the caller's own client are
 * granted here. `client.coupons.*` is deliberately left out: ClientCouponService
 * takes no actor, so granting it would expose every client's coupon codes and
 * tokens. Add it once that module is scoped.
 *
 * Additive and idempotent — it never removes permissions a role already holds,
 * so roles curated in the UI keep their extras. Run with:
 *   npx tsx prisma/seed-client-roles.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";

const db = new PrismaClient();

/** Role name -> the permission codes that role should hold. */
const clientRolePermissions: Record<string, string[]> = {
  // A client administrator runs its own company account: its own users, its
  // wallet and the cards and discounts attached to it.
  Client: [
    "clients.read",
    "clients.create",
    "clients.edit",
    "client.wallets.read",
    "client.wallets.edit",
    "cards.read",
    "cards.copy.read",
    "discounts.read",
  ],
  // A plain client user only looks: no wallet movements, no user management.
  "Client user": [
    "client.wallets.read",
    "cards.read",
    "cards.copy.read",
    "discounts.read",
  ],
};

async function main() {
  const wanted = [...new Set(Object.values(clientRolePermissions).flat())];
  const permissions = await db.permission.findMany({
    where: { code: { in: wanted } },
    select: { id: true, code: true },
  });
  const idByCode = new Map(permissions.map((row) => [row.code, row.id]));

  const missing = wanted.filter((code) => !idByCode.has(code));
  if (missing.length) {
    throw new Error(
      `These permission codes do not exist in the database: ${missing.join(", ")}. ` +
        "Seed modules and permissions first.",
    );
  }

  for (const [name, codes] of Object.entries(clientRolePermissions)) {
    const role = await db.role.upsert({
      where: { name },
      update: { isActive: true },
      create: { name, isActive: true },
    });
    const { count } = await db.rolePermission.createMany({
      data: codes.map((code) => ({ roleId: role.id, permissionId: idByCode.get(code)! })),
      skipDuplicates: true,
    });
    const total = await db.rolePermission.count({ where: { roleId: role.id } });
    console.log(`${name}: granted ${count} new permission(s), ${total} held in total`);
  }
}

main()
  .catch((error) => {
    console.error("Client role seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
