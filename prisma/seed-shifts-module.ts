/**
 * Adds the "Shifts" module to the sidebar with its `shifts.*` permissions, and
 * grants them — the same result as creating it on the Modules page, but
 * repeatable on any environment.
 *
 * - System Administrator: every `shifts.*` permission.
 * - PSS MANAGER (site managers): read, create, edit, delete. The API keeps a
 *   site manager to his own site, and only a super administrator can change
 *   shift names, whatever permissions a role holds.
 *
 * Idempotent: running it again changes nothing. Run with:
 *   npx tsx prisma/seed-shifts-module.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { generatingPermissions } from "../src/utils/utils.js";

const db = new PrismaClient();

const MODULE = { name: "Shifts", code: "SHIFTS", icon: "CalendarClock" };
/** Sits beside the other forecourt operations. */
const PARENT_CODE = "PSS_OPERATION_FORECOURT_SERVICE_BAY_SHOP_CAR_WASH";

const GRANTS: Record<string, string[]> = {
  "System Administrator": ["shifts.read", "shifts.create", "shifts.edit", "shifts.delete", "shifts.manage"],
  "PSS MANAGER": ["shifts.read", "shifts.create", "shifts.edit", "shifts.delete"],
};

async function main() {
  const parent = await db.module.findFirst({ where: { code: PARENT_CODE } });
  if (!parent) throw new Error(`Parent module ${PARENT_CODE} not found`);

  let module = await db.module.findFirst({ where: { code: MODULE.code } });
  if (!module) {
    const last = await db.module.aggregate({ where: { parentId: parent.id }, _max: { sorting: true } });
    module = await db.module.create({
      data: {
        ...MODULE,
        parentId: parent.id,
        sorting: (last._max.sorting ?? 0) + 1,
        permissions: { createMany: { data: generatingPermissions(MODULE.name) } },
      },
    });
    console.log(`created module "${MODULE.name}" under "${parent.name}"`);
  } else {
    console.log(`module "${MODULE.name}" already exists`);
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
    console.error("Shifts module seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
