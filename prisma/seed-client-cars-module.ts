/**
 * Adds the "Client Cars" module to the sidebar beside "Clients", with its
 * `client.cars.*` permissions, and grants them — the
 * same result as creating it on the Modules page, but repeatable on any
 * environment.
 *
 * Idempotent: running it again changes nothing. Run with:
 *   npx tsx prisma/seed-client-cars-module.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { generatingPermissions } from "../src/utils/utils.js";

const db = new PrismaClient();

const MODULE = { name: "Client Cars", code: "CLIENT_CARS", icon: "Car" };
/** The module it sits beside; it shares its parent and its sorting. */
const BESIDE_CODE = "CLIENTS";

const GRANTS: Record<string, string[]> = {
  "System Administrator": [
    "client.cars.read", "client.cars.create", "client.cars.edit", "client.cars.delete", "client.cars.manage",
  ],
  // A client's own people manage their own cars; the API keeps them to their client.
  "Client": ["client.cars.read", "client.cars.create", "client.cars.edit"],
  "Client user": ["client.cars.read"],
};

async function main() {
  const sibling = await db.module.findFirst({ where: { code: BESIDE_CODE } });
  if (!sibling) throw new Error(`Module ${BESIDE_CODE} not found`);

  const existing = await db.module.findFirst({ where: { code: MODULE.code } });
  if (existing) {
    console.log(`module "${MODULE.name}" already exists`);
  } else {
    await db.module.create({
      data: {
        ...MODULE,
        parentId: sibling.parentId,
        sorting: sibling.sorting,
        permissions: { createMany: { data: generatingPermissions(MODULE.name) } },
      },
    });
    console.log(`created module "${MODULE.name}" beside "${sibling.name}"`);
  }

  for (const [roleName, codes] of Object.entries(GRANTS)) {
    const role = await db.role.findUnique({ where: { name: roleName } });
    if (!role) {
      console.log(`role "${roleName}" not found — skipped`);
      continue;
    }
    const permissions = await db.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    const { count } = await db.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
    console.log(`${roleName}: granted ${count} new permission(s)`);
  }
}

main()
  .catch((error) => {
    console.error("Client cars module seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
