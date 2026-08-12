import { PrismaClient } from "../prisma/generated/prisma/client.js";
import bcrypt from "bcryptjs";
import { loadConfig } from "../src/config/env.js";
import { hashPin } from "../src/utils/crypto.js";
import { moduleSeeds } from "./seed-data.js";

const db = new PrismaClient();
const config = loadConfig();

async function seedModulesAndPermissions() {
  const moduleIds = new Map<string, string>();

  for (const definition of moduleSeeds) {
    const module = await db.module.upsert({
      where: { code: definition.code },
      update: { name: definition.name, sorting: definition.sorting },
      create: { name: definition.name, code: definition.code, sorting: definition.sorting }
    });
    moduleIds.set(definition.code, module.id);
  }

  const permissionIds: string[] = [];
  for (const definition of moduleSeeds) {
    const moduleId = moduleIds.get(definition.code)!;
    const parentId = definition.parentCode ? moduleIds.get(definition.parentCode)! : null;
    await db.module.update({ where: { id: moduleId }, data: { parentId } });

    for (const permissionDefinition of definition.permissions) {
      const permission = await db.permission.upsert({
        where: { code: permissionDefinition.code },
        update: {
          name: permissionDefinition.name,
          description: permissionDefinition.description,
          moduleId
        },
        create: { ...permissionDefinition, moduleId }
      });
      permissionIds.push(permission.id);
    }
  }

  return permissionIds;
}

async function main() {
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
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      pinHash: hashPin(pin, config.PIN_HMAC_SECRET),
      firstName: "System",
      lastName: "Administrator",
      roleId: role.id
    }
  });

  console.log(`Seeded ${moduleSeeds.length} modules, ${permissionIds.length} permissions, and administrator ${email}.`);
}

main()
  .catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());