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
  /** The signature a user signs documents with, and nothing else. */
  findSignature(userId: string) {
    return this.db.user.findUnique({ where: { id: userId }, select: { signatureUrl: true } });
  }

  /** Sets or clears it. `null` is "no signature on record". */
  saveSignature(userId: string, signatureUrl: string | null) {
    return this.db.user.update({
      where: { id: userId },
      data: { signatureUrl },
      select: { signatureUrl: true },
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
  /**
   * A login waiting on its emailed code.
   *
   * Any code still open for this user is spent first: asking again replaces
   * the code rather than adding a second one that would also work.
   */
  async createLoginOtp(userId: string, codeHash: string, expiresAt: Date) {
    const [, challenge] = await this.db.$transaction([
      this.db.loginOtp.updateMany({
        where: { userId, usedAt: null }, data: { usedAt: new Date() },
      }),
      this.db.loginOtp.create({ data: { userId, codeHash, expiresAt } }),
    ]);
    return challenge;
  }

  findLoginOtp(id: string) {
    return this.db.loginOtp.findUnique({ where: { id } });
  }

  /** A wrong code counted against the challenge, which dies at the limit. */
  countLoginOtpAttempt(id: string) {
    return this.db.loginOtp.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }

  /** Spent, so the same code cannot sign anyone in twice. */
  consumeLoginOtp(id: string) {
    return this.db.loginOtp.update({ where: { id }, data: { usedAt: new Date() } });
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
