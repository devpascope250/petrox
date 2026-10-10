/**
 * Adds "Sales" to the sidebar under PSS STOCK, holding "Fuel Sales" and
 * "Fuel Sales Report", each with its permissions, and grants them — the same
 * result as creating them on the Modules page, but repeatable on any
 * environment.
 *
 * - System Administrator: everything.
 * - PSS MANAGER (site managers): see and record fuel sales, and read the
 *   report. The API keeps site staff to their own site.
 *
 * Idempotent: running it again changes nothing. Run with:
 *   npx tsx prisma/seed-fuel-sales-modules.ts
 */
import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { generatingPermissions } from "../src/utils/utils.js";

const db = new PrismaClient();

/** Sits beside Cuve Stock. */
const PARENT_CODE = "PSS_STOCK";
const GROUP = { name: "Sales", code: "SALES", icon: "Receipt" };
const PAGES = [
  { name: "Fuel Sales", code: "FUEL_SALES", icon: "Fuel" },
  { name: "Fuel Sales Report", code: "FUEL_SALES_REPORT", icon: "ChartColumn" },
];

const GRANTS: Record<string, string[]> = {
  "System Administrator": [
    "fuel.sales.read", "fuel.sales.create", "fuel.sales.edit", "fuel.sales.delete", "fuel.sales.manage",
    "fuel.sales.report.read", "fuel.sales.report.manage",
  ],
  "PSS MANAGER": ["fuel.sales.read", "fuel.sales.create", "fuel.sales.report.read"],
};

async function ensureModule(module: { name: string; code: string; icon: string }, parentId: string) {
  const existing = await db.module.findFirst({ where: { code: module.code } });
  if (existing) {
    console.log(`module "${module.name}" already exists`);
    return existing;
  }
  const last = await db.module.aggregate({ where: { parentId }, _max: { sorting: true } });
  const created = await db.module.create({
    data: {
      ...module,
      parentId,
      sorting: (last._max.sorting ?? 0) + 1,
      permissions: { createMany: { data: generatingPermissions(module.name) } },
    },
  });
  console.log(`created module "${module.name}"`);
  return created;
}

async function main() {
  const parent = await db.module.findFirst({ where: { code: PARENT_CODE } });
  if (!parent) throw new Error(`Parent module ${PARENT_CODE} not found`);

  const group = await ensureModule(GROUP, parent.id);
  for (const page of PAGES) await ensureModule(page, group.id);

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
    console.error("Fuel sales modules seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
