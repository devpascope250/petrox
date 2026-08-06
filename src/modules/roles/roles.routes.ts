import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/index.js";
import { paginationQuerySchema, parseInput } from "../../shared/validation/index.js";
import { createRoleSchema } from "./roles.schema.js";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.authenticate, app.authorize("roles.read")] }, async (request) => {
    const query = parseInput(paginationQuerySchema, request.query);
    const [items, total] = await app.prisma.$transaction([
      app.prisma.role.findMany({
        ...paginationArgs(query),
        orderBy: { name: "asc" },
        include: { permissions: { include: { permission: true } } }
      }),
      app.prisma.role.count()
    ]);
    return success(paginatedData(items, total, query));
  });

  app.post("/", { preHandler: [app.authenticate, app.authorize("roles.manage")] }, async (request, reply) => {
    const input = parseInput(createRoleSchema, request.body);
    const role = await app.prisma.role.create({
      data: { name: input.name, permissions: { create: input.permissionIds.map((permissionId) => ({ permissionId })) } }
    });
    return created(reply, role);
  });
};

export default routes;