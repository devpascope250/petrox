import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { ModuleAccessRow } from "./modules.types.js";

export class ModulesRepository {
  constructor(private readonly db: PrismaClient) {}

  async listAccessForRole(roleId: string): Promise<ModuleAccessRow[]> {
    const modules = await this.db.module.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        parentId: true,
        sorting: true,
        permissions: {
          where: { rolePermissions: { some: { roleId } } },
          select: { id: true }
        }
      }
    });
    return modules.map(({ permissions, ...module }) => ({
      ...module,
      hasPermission: permissions.length > 0
    }));
  }
}
