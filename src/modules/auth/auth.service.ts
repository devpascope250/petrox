import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/env.js";
import { createOpaqueToken, hashToken, verifyPin } from "../../utils/crypto.js";
import { AppError, BusinessError, unauthorized } from "../../utils/errors.js";
import { staticUrl } from "../../utils/static-url.js";
import { readMobileForm } from "../mobile/transactions/transaction-form.js";
import { AuthRepository } from "./auth.repository.js";
import { emailService} from "../../utils/emailService.js";
import type { ChangePasswordInput } from "./auth.schema.js";

/** Removes an uploaded file by its `/uploads/…` path; anything else is left alone. */
async function removeUpload(uploaded: string | null) {
  if (!uploaded?.startsWith("/uploads/")) return;
  await rm(path.join(process.cwd(), "uploads", path.basename(uploaded)), { force: true });
}
type AuthUser = NonNullable<Awaited<ReturnType<AuthRepository["findUserByEmail"]>>>;

export class AuthService {
  constructor(private repo: AuthRepository, private app: FastifyInstance, private config: AppConfig) {}
  permissions(user: AuthUser) {
    return user.role ? user.role.permissions.map((item) => item.permission.code) : null;
  }
  private publicUser(user: AuthUser) {
    // `position`, `clientId` and `client` let the frontend pick the client
    // portal over the admin layout, and name the account, without a second call.
    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role?.name, position: user.position, sites: user.sites, clientId: user.clientId, client: user.client,
      // Whether they can sign: a loading order cannot be authorized without
      // one, so the screen that asks has to know before it asks.
      signatureUrl: staticUrl(this.config.STATIC_URL ?? this.config.APP_URL, user.signatureUrl) };
  }

  /**
   * The signature this user signs documents with: their own, and only their
   * own.
   *
   * Nobody may set anybody else's. A signature stamped on an approval is the
   * claim that *that person* approved it, and an administrator who could
   * upload one on their behalf would make the trail worth nothing.
   *
   * Replacing it never reaches a document already signed: an approval copies
   * the image when it is given.
   */
  async saveSignature(userId: string, request: FastifyRequest) {
    if (!request.isMultipart()) {
      throw new BusinessError("MULTIPART_REQUIRED", "Send the signature as form data, in a `signature` field");
    }
    const form = await readMobileForm(request, [{ field: /^signature$/, kind: "image" }], 1);
    const uploaded = form.files.signature;
    if (!uploaded) {
      await form.discard();
      throw new BusinessError("SIGNATURE_REQUIRED", "Choose an image of your signature");
    }
    try {
      const current = await this.repo.findSignature(userId);
      const saved = await this.repo.saveSignature(userId, uploaded);
      // Only once the new one is stored: a failure must not leave the user
      // with neither.
      await removeUpload(current?.signatureUrl ?? null);
      return { signatureUrl: staticUrl(this.config.STATIC_URL ?? this.config.APP_URL, saved.signatureUrl) };
    } catch (error) {
      await form.discard();
      throw error;
    }
  }

  /** Takes it off. Documents already signed keep the image they copied. */
  async removeSignature(userId: string) {
    const current = await this.repo.findSignature(userId);
    if (current?.signatureUrl) {
      await this.repo.saveSignature(userId, null);
      await removeUpload(current.signatureUrl);
    }
    return { signatureUrl: null };
  }

  /** The signed-in account, for restoring a session on page load. */
  async me(userId: string) {
    const user = await this.repo.findUserById(userId);
    this.ensureActive(user);
    return { user: this.publicUser(user), permissions: this.permissions(user) ?? [] };
  }
  private async issue(user: AuthUser) {
    const permissions = this.permissions(user);
    if (!user || !user?.role || !user?.roleId || !permissions) throw unauthorized();
    const accessToken = this.app.jwt.sign(
      { sub: user.id, roleId: user.roleId, role: user.role.name},
      { expiresIn: this.config.ACCESS_TOKEN_TTL }
    );
    const refreshToken = createOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await this.repo.createRefreshToken(user.id, hashToken(refreshToken), expiresAt);
    return { accessToken, refreshToken, user: this.publicUser(user), permissions };
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
  /**
   * The signed-in user's permissions grouped by the module they belong to, by
   * name rather than code — the Profile page's "my permissions".
   */
  async myPermissions(userId: string) {
    const user = await this.repo.findUserById(userId);
    this.ensureActive(user);
    const rows = user.roleId ? await this.repo.permissionsOfRole(user.roleId) : [];
    type Row = (typeof rows)[number]["permission"];
    const groups = new Map<string, { module: Row["module"]; permissions: Array<Omit<Row, "module">> }>();
    for (const { permission } of rows) {
      const { module, ...rest } = permission;
      const group = groups.get(module.id) ?? { module, permissions: [] };
      group.permissions.push(rest);
      groups.set(module.id, group);
    }
    return {
      role: user.role ? { id: user.role.id, name: user.role.name } : null,
      total: rows.length,
      modules: [...groups.values()],
    };
  }

  /**
   * Changes your own password. The current one must be given, and every other
   * session is signed out; this one carries on with a fresh pair of tokens.
   */
  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await this.repo.findUserById(userId);
    this.ensureActive(user);
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new AppError(422, "CURRENT_PASSWORD_WRONG", "That is not your current password");
    }
    await this.repo.changePassword(userId, await bcrypt.hash(input.newPassword, 12));
    // Re-read, so the session is issued from the record as it now stands.
    const updated = await this.repo.findUserById(userId);
    this.ensureActive(updated);
    return this.issue(updated);
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
