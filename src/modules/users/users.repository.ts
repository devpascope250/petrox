import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { generateClientCode } from "../../utils/crypto.js";
import type { CreateUserInput } from "./users.schema.js";

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  position: true,
  clientId: true,
  siteId: true,
  client: true,
  sites: { select: { siteId: true, status: true, site: true } },
  isActive: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true
} satisfies Prisma.UserSelect;

export class UsersRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery) {
    return this.db.$transaction([
      this.db.user.findMany({ ...paginationArgs(query),where: {clientId: {equals: null }} , orderBy: { createdAt: "desc" }, select: publicUserSelect }),
      this.db.user.count({where: {clientId: {equals: null}}})
    ]);
  }

  create(input: CreateUserInput, passwordHash: string, pinHash: string) {
    return this.db.$transaction(async (tx) => {
      let clientId: string | undefined;
      if (input.position === "clientAdmin") {
        const client = await tx.client.create({
          data: { ...input.clientDetails, clientCode: generateClientCode() }
        });
        clientId = client.id;
      } else if (input.position === "clientUser") {
        clientId = input.clientId;
      }
      const siteId = input.position === "siteManager" ? input.siteId : undefined;
      return tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          pinHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          roleId: input.roleId,
          position: input.position,
          clientId,
          siteId,
          ...(siteId ? { sites: { create: { siteId } } } : {})
        },
        select: publicUserSelect
      });
    });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.db.user.update({ where: { id }, data, select: publicUserSelect });
  }

  async updateStatus(id: string) {
    const user = await this.find(id);
    if (!user) throw new NotFoundError("User");
    return this.db.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: publicUserSelect
    });
  }

  find(id: string) {
    return this.db.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  findSite(id: string) {
    return this.db.tblSite.findUnique({ where: { id }, select: { id: true } });
  }

  assignSite(userId: string, siteId: string) {
    return this.db.$transaction(async (tx) => {
      await tx.userSites.updateMany({
        where: { userId, status: "active" },
        data: { status: "inactive" }
      });

      await tx.userSites.upsert({
        where: { userId_siteId: { userId, siteId } },
        create: { userId, siteId, status: "active" },
        update: { status: "active" }
      });

      return tx.user.update({
        where: { id: userId },
        data: { siteId },
        select: publicUserSelect
      });
    });
  }

  delete(id: string) {
    return this.db.user.delete({ where: { id }, select: publicUserSelect });
  }
}
