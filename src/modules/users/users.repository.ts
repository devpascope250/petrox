import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  role: { select: { id: true, name: true } },
  createdAt: true
} satisfies Prisma.UserSelect;

export class UsersRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery) {
    return this.db.$transaction([
      this.db.user.findMany({ ...paginationArgs(query), orderBy: { createdAt: "desc" }, select: publicUserSelect }),
      this.db.user.count()
    ]);
  }

  create(data: Prisma.UserUncheckedCreateInput) {
    return this.db.user.create({
      data,
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, roleId: true }
    });
  }
  async updateStatus(id: string){
    const user = await this.find(id);
    if(!user) throw new NotFoundError();
    return this.db.user.update({
      where: {
        id
      },
      data: {
        isActive: !user.isActive
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
      }
    })
  }

  find(id: string) {
    return this.db.user.findUnique({ where: { id }, select: publicUserSelect });
  }
}