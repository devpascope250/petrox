import type { PrismaClient } from "../../../generated/prisma/client.js";

export class AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });
  }
  findUserById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
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
  async consumePasswordResetToken(id: string, userId: string, passwordHash: string) {
    return this.db.$transaction([
      this.db.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } }),
      this.db.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
  }
}
