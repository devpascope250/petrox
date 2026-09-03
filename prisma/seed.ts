import { PrismaClient, type TimeLineStatus } from "../prisma/generated/prisma/client.js";
import bcrypt from "bcryptjs";
import { loadConfig } from "../src/config/env.js";
import { hashPin } from "../src/utils/crypto.js";
import { moduleSeeds, validateModuleSeeds } from "./seed-data.js";

const db = new PrismaClient();
const config = loadConfig();

async function seedModulesAndPermissions() {
  validateModuleSeeds();
  return db.$transaction(async (tx) => {
    const moduleIds = moduleSeeds.map((module) => module.id);
    const moduleCodes = moduleSeeds.map((module) => module.code);
    const desiredPermissionCodes = moduleSeeds.flatMap((module) =>
      module.permissions.map((permission) => permission.code));

    // Remove rows that would conflict with the fixed IDs from sidebar-flat.json.
    await tx.module.deleteMany({
      where: { code: { in: moduleCodes }, id: { notIn: moduleIds } },
    });

    // Create roots first. Parent links are applied only after every fixed ID exists.
    for (const definition of moduleSeeds) {
      await tx.module.upsert({
        where: { id: definition.id },
        update: { name: definition.name, code: definition.code, sorting: definition.sorting, parentId: null },
        create: {
          id: definition.id, name: definition.name, code: definition.code,
          sorting: definition.sorting, parentId: null,
        },
      });
    }

    for (const definition of moduleSeeds) {
      await tx.module.update({
        where: { id: definition.id }, data: { parentId: definition.parentId },
      });
    }

    const permissionIds: string[] = [];
    for (const definition of moduleSeeds) {
      for (const permissionDefinition of definition.permissions) {
        const permission = await tx.permission.upsert({
          where: { code: permissionDefinition.code },
          update: { ...permissionDefinition, moduleId: definition.id },
          create: { ...permissionDefinition, moduleId: definition.id },
        });
        permissionIds.push(permission.id);
      }
    }

    await tx.permission.deleteMany({
      where: { moduleId: { in: moduleIds }, code: { notIn: desiredPermissionCodes } },
    });
    await tx.module.deleteMany({ where: { id: { notIn: moduleIds } } });

    return permissionIds;
  });
}

const nominationTimeLineStatuses: Array<{
  status: TimeLineStatus;
  level: number;
  descriptions: string;
}> = [
  { status: "awaiting", level: 1, descriptions: "Awaiting loading documents" },
  { status: "underLoading", level: 2, descriptions: "Loading in progress" },
  { status: "t1Pending", level: 3, descriptions: "Release in progress" },
  {
    status: "t1Confirmed",
    level: 4,
    descriptions:
      "Released, In transit from foreign depot to owner, In transit from border to local depot, Parked at local depot"
  },
  { status: "stockReceived", level: 5, descriptions: "Stock received" }
];

async function seedNominationTimeLineStatuses() {
  for (const definition of nominationTimeLineStatuses) {
    await db.nominationTimeLineStatus.upsert({
      where: { status: definition.status },
      update: {
        level: definition.level,
        descriptions: definition.descriptions
      },
      create: definition
    });
  }
}

async function main() {
  await seedNominationTimeLineStatuses();
  const permissionIds = await seedModulesAndPermissions();
  const role = await db.role.upsert({
    where: { name: "Administrator" },
    update: { isFixed: true, isActive: true },
    create: { name: "Administrator", isFixed: true }
  });

  await db.rolePermission.createMany({
    data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    skipDuplicates: true
  });

  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase() ?? "admin@petrox.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const pin = process.env.SEED_ADMIN_PIN ?? "1234";
  await db.user.upsert({
    where: { email },
    update: {
      firstName: "System",
      lastName: "Administrator",
      roleId: role.id,
      position: "superAdmin",
      isActive: true,
    },
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      pinHash: hashPin(pin, config.PIN_HMAC_SECRET),
      firstName: "System",
      lastName: "Administrator",
      roleId: role.id,
      position: "superAdmin",
    }
  });

  console.log(
    `Seeded ${nominationTimeLineStatuses.length} nomination timeline statuses, ${moduleSeeds.length} modules, ${permissionIds.length} permissions, and administrator ${email}.`
  );
}

main()
  .catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
