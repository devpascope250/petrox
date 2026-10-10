import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { AuthUser, isSiteBound } from "../../shared/auth/context-user.js";
import { NotFoundError } from "../../utils/errors.js";
import { CreateSiteSchema } from "./sites.schema.js";
export class SiteRepository {
  constructor(private db: PrismaClient) {}

  async list(actor: AuthUser) {
    if (isSiteBound(actor)) {
      if (!actor.siteId) throw new NotFoundError("This User Must Have Site Assigned to Him")
    }
  const whereClause = actor.siteId ? { id: actor.siteId} : {};
    return await this.db.tblSite.
    findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        status: true,
        createdAt: true,
        pumps: {
          select: {
            id: true,
            name: true,
            status: true,
          }
        }
      },
    });
  }

  create(data: CreateSiteSchema) {
    return this.db.tblSite.create({
      data: {
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateSiteSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.tblSite.update({
      where: { id: id },
      data: {
        ...data
      },
    });
  }

  async changeStatus(id: string) {
    const site = await this.find(id);
    if (!site) throw new NotFoundError();
    return await this.db.tblSite.update({
      where: { id },
      data: { status: site.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.tblSite.findUnique({ where: { id } });
  }
}
