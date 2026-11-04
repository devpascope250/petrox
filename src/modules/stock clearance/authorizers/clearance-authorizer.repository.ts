import type { PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../../utils/errors.js";
import { ClearanceAuthorizerMemberSchema } from "./clearance-authorizer.schema.js";

const memberSelect = {
  id: true, status: true, level: true, position: true, createdAt: true,
  authoriser: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } },
  _count: { select: { approvals: true } },
} as const;

export class ClearanceAuthorizerMemberRepository {
  constructor(private db: PrismaClient) {}

  list() {
    return this.db.clearanceAuthorizerMember.findMany({
      orderBy: [{ level: "asc" }, { createdAt: "asc" }],
      select: memberSelect,
    });
  }

  find(id: string) {
    return this.db.clearanceAuthorizerMember.findUnique({ where: { id }, select: memberSelect });
  }

  async create(data: ClearanceAuthorizerMemberSchema) {
    await this.assertUser(data.authorizerId);
    const existing = await this.db.clearanceAuthorizerMember.findUnique({
      where: { authorizerId: data.authorizerId }, select: { id: true },
    });
    if (existing) throw new BusinessError("400", "This person is already a clearance authorizer");
    return this.db.clearanceAuthorizerMember.create({
      data: {
        authorizerId: data.authorizerId,
        position: data.position ?? null,
        level: data.level ?? null,
      },
      select: memberSelect,
    });
  }

  /**
   * The person cannot be swapped once they have decided on a clearance: their
   * decisions are theirs. The position and level are only labels, so those
   * stay editable.
   */
  async update(id: string, data: ClearanceAuthorizerMemberSchema) {
    const current = await this.db.clearanceAuthorizerMember.findUnique({
      where: { id }, select: { authorizerId: true, _count: { select: { approvals: true } } },
    });
    if (!current) throw new NotFoundError("Clearance authorizer not found");
    if (current._count.approvals > 0 && current.authorizerId !== data.authorizerId) {
      throw new BusinessError("400", "The person cannot change once this authorizer has decided on a clearance");
    }
    await this.assertUser(data.authorizerId);
    return this.db.clearanceAuthorizerMember.update({
      where: { id },
      data: {
        authorizerId: data.authorizerId,
        position: data.position ?? null,
        level: data.level ?? null,
      },
      select: memberSelect,
    });
  }

  async changeStatus(id: string) {
    const member = await this.db.clearanceAuthorizerMember.findUnique({
      where: { id }, select: { status: true },
    });
    if (!member) throw new NotFoundError("Clearance authorizer not found");
    return this.db.clearanceAuthorizerMember.update({
      where: { id },
      data: { status: member.status === "active" ? "inactive" : "active" },
      select: memberSelect,
    });
  }

  async delete(id: string) {
    const member = await this.db.clearanceAuthorizerMember.findUnique({
      where: { id }, select: { _count: { select: { approvals: true } } },
    });
    if (!member) throw new NotFoundError("Clearance authorizer not found");
    if (member._count.approvals > 0) {
      throw new BusinessError("400", "An authorizer who has decided on a clearance cannot be deleted; deactivate them instead");
    }
    return this.db.clearanceAuthorizerMember.delete({ where: { id } });
  }

  private async assertUser(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { isActive: true, email: true } });
    if (!user) throw new NotFoundError("User not found");
    if (!user.isActive) throw new BusinessError("400", "An inactive user cannot be a clearance authorizer");
    if (!user.email) throw new BusinessError("400", "A clearance authorizer needs an email address to be notified");
  }
}
