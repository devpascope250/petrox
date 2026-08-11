import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import {
  paginatedData,
  paginationArgs,
} from "../../shared/pagination/index.js";
import {
  paginationQuerySchema,
  parseInput,
} from "../../shared/validation/index.js";
import {
  assignPermissionsToRole,
  createRoleSchema,
  deleteParamSchema,
} from "./roles.schema.js";
import { NotFoundError } from "../../utils/errors.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    { preHandler: [app.authenticate, app.authorize("roles.read")] },
    async (request) => {
      const query = parseInput(paginationQuerySchema, request.query);
      const [items, total] = await app.prisma.$transaction([
        app.prisma.role.findMany({
          ...paginationArgs(query),
          orderBy: { name: "asc" },
          include: { permissions: { include: { permission: true } } },
        }),
        app.prisma.role.count(),
      ]);
      return success(paginatedData(items, total, query));
    },
  );

  app.post(
    "/",
    { preHandler: [app.authenticate, app.authorize("roles.manage")] },
    async (request, reply) => {
      const input = parseInput(createRoleSchema, request.body);
      const role = await app.prisma.role.create({
        data: {
          name: input.name,
          permissions: {
            create: input.permissionIds.map((permissionId) => ({
              permissionId,
            })),
          },
        },
      });
      return created(reply, role);
    },
  );

  app.delete(
    "/:id",
    { preHandler: [app.authenticate, app.authorize("roles.manage")] },
    async (request, reply) => {
      const input = parseInput(deleteParamSchema, request.params);
      if (!(await app.prisma.role.findUnique({ where: { id: input.id } })))
        throw new NotFoundError(`This Role with ${input.id} does nnot exist`);
      return success(await app.prisma.role.delete({ where: { id: input.id } }));
    },
  );

  app.put(
    "/assign-permissions/:id",
    { preHandler: [app.authenticate, app.authorize("roles.manage")] },
    async (request) => {
      const input = parseInput(deleteParamSchema, request.params);
      const data = parseInput(
        assignPermissionsToRole,
        request.body,
      );
      if (!(await app.prisma.role.findUnique({ where: { id: input.id } })))
        throw new NotFoundError(`This Role with ${input.id} does nnot exist`);
      const updated = await app.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({
          where: {
            roleId: input.id,
            id: {
              notIn: data.permissionIds
            }
          }
        })
        await tx.role.update({where: {id: input.id}, data: {name: data.name}});
        const permissions = data.permissionIds.map(async (permission) => {
          return await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: input.id,
                permissionId: permission,
              },
            },
            update: {
              permissionId: permission,
            },
            create: {
              roleId: input.id,
              permissionId: permission,
            },
          });
        });

        return await Promise.all(permissions);
      });

      return success(updated);
    },
  );

  // update status

  app.put(
    "/status/:id",
    { preHandler: [app.authenticate, app.authorize("roles.manage")] },
    async (request) => {
      const input = parseInput(deleteParamSchema, request.params);
      const role = await app.prisma.role.findUnique({ where: { id: input.id } })
      if (!role)  throw new NotFoundError(`This Role with ${input.id} does nnot exist`);
       return success(await app.prisma.role.update({where: {id: input.id}, data: {isActive: !role.isActive}}));
    },
  );
};

export default routes;
