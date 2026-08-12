import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { generatingPermissions } from "../../utils/utils.js";
import { ModuleItemsSchemaBody, ModuleSchemaBody } from "./module.schema.js";
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
          select: { id: true },
        },
      },
    });
    return modules.map(({ permissions, ...module }) => ({
      ...module,
      hasPermission: permissions.length > 0,
    }));
  }

  async create(data: ModuleSchemaBody) {
    return await this.db.$transaction(async (tx) => {
      const modules = data.map(async (dt) => {
        return await tx.module.create({
          data: {
            ...dt,
            permissions: {
              createMany: {
                data: generatingPermissions(dt.name),
              },
            },
          },
        });
      });

      return await Promise.all(modules);
    });
  }

  async delete(id: string) {
    return await this.db.module.deleteMany({ where: { id } });
  }

  async find(id: string) {
    return await this.db.module.findUnique({ where: { id } });
  }

  async findAll() {
    return await this.db.module.findMany({
      include: {
        permissions: true,
        children: {
          include: {
            permissions: true,
          }
        }
      },
    });
  }

  async update(id: string, data: ModuleItemsSchemaBody) {
    return await this.db.module.update({
      where: {
        id,
      },
      data: data,
    });
  }
}
