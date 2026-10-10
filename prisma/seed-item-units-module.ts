/**
 * Adds the "Item Units" module to the sidebar, right after "Item Price", with
 * its `item.units.*` permissions, and grants them to System Administrator —
 * the same result as creating it on the Modules page, but repeatable on any
 * environment.
 *
 * Idempotent: running it again changes nothing. Run with:
 *   npx tsx prisma/seed-item-units-module.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { generatingPermissions } from "../src/utils/utils.js";

const db = new PrismaClient();

const MODULE = { name: "Item Units", code: "ITEM_UNITS", icon: "Scale" };
/** The module it sits after; it shares its parent and its sorting. */
const AFTER_CODE = "ITEM_PRICE";

const GRANTS: Record<string, string[]> = {
  "System Administrator": [
    "item.units.read", "item.units.create", "item.units.edit", "item.units.delete", "item.units.manage",
  ],
};

async function main() {
  const sibling = await db.module.findFirst({ where: { code: AFTER_CODE } });
  if (!sibling) throw new Error(`Module ${AFTER_CODE} not found`);

  const existing = await db.module.findFirst({ where: { code: MODULE.code } });
  if (existing) {
    console.log(`module "${MODULE.name}" already exists`);
  } else {
    await db.module.create({
      data: {
        ...MODULE,
        parentId: sibling.parentId,
        // Same sorting as Item Price: ties are broken by name, which puts
        // "Item Units" straight after it.
        sorting: sibling.sorting,
        permissions: { createMany: { data: generatingPermissions(MODULE.name) } },
      },
    });
    console.log(`created module "${MODULE.name}" after "${sibling.name}"`);
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
    console.error("Item units module seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
