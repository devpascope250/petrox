import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { assertCarItems, assertPlatesFree } from "../client-cars/client-car.repository.js";
import { AuthUser } from "../../shared/auth/context-user.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { generateClientCode } from "../../utils/crypto.js";
import type { CreateUserInput } from "./clients.schema.js";

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  position: true,
  clientId: true,
  client: true,
  siteId: true,
  isActive: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true
} satisfies Prisma.UserSelect;

const organizationSelect = {
  id: true, clientCode: true, name: true, phone: true, email: true, idTino: true,
  province: true, district: true, sector: true, status: true, subsidyAllowed: true,
  pinHash: true,
  users: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, position: true, isActive: true },
  },
} satisfies Prisma.ClientSelect;

export class ClientRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery, actor: AuthUser) {
    const whereClause = {
      ...(actor.position === "clientAdmin" ?  {clientId: actor.clientId} : {clientId : {not: { equals: null}}}),
      // id: {not: {equals: actor.userId}},
      
    }
    return this.db.$transaction([
      this.db.user.findMany({ ...paginationArgs(query), where: whereClause, orderBy: { createdAt: "desc" }, select: publicUserSelect }),
      this.db.user.count({where: whereClause})
    ]);
  }

  /**
   * The client organisations themselves, with their users, so one with no
   * user left still shows. A client admin sees only their own.
   */
  organizations(query: PaginationQuery, actor: AuthUser) {
    const where: Prisma.ClientWhereInput = actor.position === "clientAdmin" ? { id: actor.clientId ?? "" } : {};
    return this.db.$transaction([
      this.db.client.findMany({
        ...paginationArgs(query), where, orderBy: [{ name: "asc" }, { clientCode: "asc" }], select: organizationSelect,
      }),
      this.db.client.count({ where }),
    ]);
  }

  findOrganization(id: string) {
    return this.db.client.findUnique({ where: { id }, select: { id: true } });
  }

  updateOrganization(id: string, data: Prisma.ClientUpdateInput) {
    return this.db.client.update({ where: { id }, data, select: organizationSelect });
  }

  /** `clientPinHash`: the new client's own PIN, already hashed, when one was given. */
  create(input: CreateUserInput, passwordHash: string, pinHash: string, clientPinHash?: string) {
    return this.db.$transaction(async (tx) => {
      let clientId: string | undefined;
      if (input.position === "clientAdmin") {
        // The plain PIN is never stored: only its hash.
        const { pin: _pin, ...details } = input.clientDetails;
        const client = await tx.client.create({
          data: { ...details, clientCode: generateClientCode(), pinHash: clientPinHash ?? null }
        });
        clientId = client.id;
        if (input.cars?.length) {
          await assertPlatesFree(tx, input.cars.map((car) => car.plateNo));
          await assertCarItems(tx, input.cars.map((car) => car.itemId));
          await tx.clientCar.createMany({ data: input.cars.map((car) => ({ ...car, clientId: client.id })) });
        }
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

  /**
   * Updates the user, and the client company it belongs to when company details
   * were supplied. Both land in one transaction so a half-saved edit is never
   * visible, and the client is written first so the returned user carries it.
   */
  update(
    id: string,
    data: Prisma.UserUpdateInput,
    client?: { id: string; data: Prisma.ClientUpdateInput }
  ) {
    if (!client) {
      return this.db.user.update({ where: { id }, data, select: publicUserSelect });
    }
    return this.db.$transaction(async (tx) => {
      await tx.client.update({ where: { id: client.id }, data: client.data });
      return tx.user.update({ where: { id }, data, select: publicUserSelect });
    });
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
