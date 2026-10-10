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
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { Prisma } from "../../../prisma/generated/prisma/client.js";

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
      const permissionIds = [...new Set(data.permissionIds)];

      // Removing role management from your own role would lock you out of this
      // screen with no way back in, so that one change is refused.
      if (input.id === request.contextUser!.roleId) {
        const kept = await app.prisma.permission.count({
          where: { id: { in: permissionIds }, code: "roles.manage" },
        });
        if (kept === 0) {
          throw new BusinessError(
            "CANNOT_REMOVE_OWN_ROLE_ACCESS",
            "You cannot remove role management from your own role — you would lose access to this page.",
          );
        }
      }

      /*
       * The list sent is the role's full set: anything missing is removed and
       * anything new is added. The old delete filtered on the join row's own id
       * rather than the permission id, so it wiped and re-created every row.
       */
      const updated = await app.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const removed = await tx.rolePermission.deleteMany({
          where: { roleId: input.id, permissionId: { notIn: permissionIds } },
        });
        const added = await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: input.id, permissionId })),
          skipDuplicates: true,
        });
        const role = await tx.role.update({
          where: { id: input.id },
          data: { name: data.name },
          include: { permissions: { include: { permission: true } } },
        });
        return { ...role, added: added.count, removed: removed.count };
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
