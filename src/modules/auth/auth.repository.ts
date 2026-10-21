import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";

export class AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: { include: { permission: true } } } }, sites: {where: {status: "active"}}, client: true }
    });
  }
  findUserById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      include: { role: { include: { permissions: { include: { permission: true } } } }, sites: {where: {status: "active"}}, client: true }
    });
  }
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }
  findRefreshToken(tokenHash: string) {
    return this.db.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
  }
  revokeRefreshToken(id: string) {
    return this.db.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
  async rotateRefreshToken(id: string, userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.$transaction([
      this.db.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }),
      this.db.refreshToken.create({ data: { userId, tokenHash, expiresAt } })
    ]);
  }
  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }
  findPasswordResetToken(tokenHash: string) {
    return this.db.passwordResetToken.findUnique({ where: { tokenHash } });
  }
  /**
   * The permissions the signed-in user holds, by name, with the module each
   * belongs to — what the Profile page shows instead of bare codes.
   */
  permissionsOfRole(roleId: string) {
    return this.db.rolePermission.findMany({
      where: { roleId },
      orderBy: [{ permission: { module: { sorting: "asc" } } }, { permission: { module: { name: "asc" } } }, { permission: { name: "asc" } }],
      select: {
        permission: {
          select: {
            id: true, name: true, code: true, description: true,
            module: { select: { id: true, name: true, code: true, icon: true, parent: { select: { id: true, name: true } } } },
          },
        },
      },
    });
  }

  /** A password the user changed themselves: every other session is dropped. */
  changePassword(userId: string, passwordHash: string) {
    return this.db.$transaction([
      this.db.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async consumePasswordResetToken(id: string, userId: string, passwordHash: string) {
    return this.db.$transaction([
      this.db.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),
      this.db.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
  }
}
