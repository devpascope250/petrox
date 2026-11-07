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
  officeId: true,
  /// The office, with its department nested: "which department is this person
  /// in" is answered through the office, which is the only place it is stored.
  office: {
    select: {
      id: true,
      officeName: true,
      officeCode: true,
      status: true,
      department: { select: { id: true, departmentName: true, departmentCode: true } }
    }
  },
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
      // Site managers and other site staff are attached to a site on creation.
      const siteId =
        input.position === "siteManager" || input.position === "others" ? input.siteId : undefined;
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
          officeId: input.officeId,
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

  findOffice(id: string) {
    return this.db.companyOffice.findUnique({
      where: { id },
      // The department's status counts too: a closed department's offices are
      // closed with it, whatever their own row still says.
      select: { id: true, status: true, department: { select: { status: true } } }
    });
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

  /**
   * The active sites, clients and offices a create-user form needs for its
   * dependent selects. `clientId` narrows the clients to one, for a client
   * administrator.
   */
  formOptions(clientId?: string) {
    return this.db.$transaction([
      this.db.tblSite.findMany({
        where: { status: "active" },
        orderBy: { name: "asc" },
        select: { id: true, name: true }
      }),
      this.db.client.findMany({
        where: { status: true, ...(clientId && { id: clientId }) },
        orderBy: { clientCode: "asc" },
        select: { id: true, clientCode: true, name: true }
      }),
      // Every active office, with its department, so the form can group them.
      // An inactive office stays on whoever is already in it but must not be
      // choosable for anyone else.
      this.db.companyOffice.findMany({
        // A closed office, or one whose whole department is closed, stays on
        // the people already in it but must not be choosable for anyone else.
        where: { status: "active", department: { status: "active" } },
        orderBy: [{ department: { departmentName: "asc" } }, { officeName: "asc" }],
        select: {
          id: true,
          officeName: true,
          officeCode: true,
          department: { select: { id: true, departmentName: true } }
        }
      })
    ]);
  }
}
