import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/env.js";
import { createOpaqueToken, hashToken, verifyPin } from "../../utils/crypto.js";
import { AppError, unauthorized } from "../../utils/errors.js";
import { AuthRepository } from "./auth.repository.js";
import { emailService} from "../../utils/emailService.js";
type AuthUser = NonNullable<Awaited<ReturnType<AuthRepository["findUserByEmail"]>>>;

export class AuthService {
  constructor(private repo: AuthRepository, private app: FastifyInstance, private config: AppConfig) {}
  private permissions(user: AuthUser) {
    return user.role ? user.role.permissions.map((item) => item.permission.code) : null;
  }
  private publicUser(user: AuthUser) {
    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role?.name };
  }
  private async issue(user: AuthUser) {
    const permissions = this.permissions(user);
    if (!user || !user?.role || !user?.roleId || !permissions) throw unauthorized();
    const accessToken = this.app.jwt.sign(
      { sub: user.id, roleId: user.roleId, role: user.role.name, permissions },
      { expiresIn: this.config.ACCESS_TOKEN_TTL }
    );
    const refreshToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.repo.createRefreshToken(user.id, hashToken(refreshToken), expiresAt);
    return { accessToken, refreshToken, expiresAt, user: this.publicUser(user), permissions };
  }
  private ensureActive(user: AuthUser | null): asserts user is AuthUser {
    if (!user || !user.isActive || !user.role?.isActive) throw unauthorized("Invalid credentials");
  }
  async login(email: string, password: string) {
    const user = await this.repo.findUserByEmail(email);
    this.ensureActive(user);
    if (!(await bcrypt.compare(password, user.passwordHash))) throw unauthorized("Invalid credentials");
    return this.issue(user);
  }
  async loginWithPin(email: string, pin: string) {
    const user = await this.repo.findUserByEmail(email);
    this.ensureActive(user);
    if (!user.pinHash || !verifyPin(pin, user.pinHash, this.config.PIN_HMAC_SECRET)) throw unauthorized("Invalid credentials");
    return this.issue(user);
  }
  async refresh(rawToken: string) {
    const stored = await this.repo.findRefreshToken(hashToken(rawToken));
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) throw unauthorized("Invalid refresh token");
    const user = await this.repo.findUserById(stored.userId);
    this.ensureActive(user);
    await this.repo.revokeRefreshToken(stored.id);
    return this.issue(user);
  }
  async logout(rawToken: string) {
    const stored = await this.repo.findRefreshToken(hashToken(rawToken));
    if (stored && !stored.revokedAt) await this.repo.revokeRefreshToken(stored.id);
  }
  async createResetToken(email: string) {
    const user = await this.repo.findUserByEmail(email);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await this.repo.createPasswordResetToken(user.id, hashToken(token), expiresAt);
    await emailService.sendPasswordResetEmail(user.email, user.firstName, token);
    return { expiresAt };
  }
  async resetPassword(token: string, password: string) {
    const stored = await this.repo.findPasswordResetToken(hashToken(token));
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) throw unauthorized("Invalid or expired reset token");
    await this.repo.consumePasswordResetToken(stored.id, stored.userId, await bcrypt.hash(password, 12));
     const user = await this.repo.findUserById(stored.userId);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    await emailService.sendPasswordResetSuccessEmail(user.email, user.firstName);
  }
}
