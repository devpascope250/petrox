import { rm } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/env.js";
import { createOpaqueToken, generateTemporaryPin, hashPin, hashToken, verifyPin } from "../../utils/crypto.js";
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

/**
 * The address shown back after a login, so the person knows where to look
 * without the whole address being echoed to whoever typed the password.
 *
 * `pascal@ikwim.rw` → `pa****@ikwim.rw`.
 */
function maskedEmail(email: string) {
  const at = email.indexOf("@");
  if (at <= 0) return "****";
  // Always four stars, whatever the length: padding to the real length would
  // say how long the address is, which is not the screen's business.
  return `${email.slice(0, Math.min(2, at))}****${email.slice(at)}`;
}

/** What a login answers with while it waits for the code. */
export interface OtpChallenge {
  otpRequired: true;
  challengeId: string;
  /** Where the code went, masked. */
  email: string;
  expiresAt: Date;
}

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
  /**
   * Signing in with a password, which on its own is no longer enough.
   *
   * The password is checked here and the session is **not** issued: a code
   * goes to the address on the account and the caller is handed a challenge to
   * confirm with. The challenge id is only ever returned once the password was
   * right, so it tells an attacker nothing it did not already know.
   *
   * A failure to send the mail fails the login. The alternative — signing
   * someone in because their code could not be delivered — is the one outcome
   * this whole step exists to prevent.
   */
  async login(email: string, password: string): Promise<OtpChallenge | Session> {
    const user = await this.repo.findUserByEmail(email);
    this.ensureActive(user);
    if (!(await bcrypt.compare(password, user.passwordHash))) throw unauthorized("Invalid credentials");
    if (!this.config.ALLOW_LOGIN_OTP) return this.issue(user);
    return this.startOtpChallenge(user);
  }

  /** Writes the challenge and sends the code. */
  private async startOtpChallenge(user: AuthUser): Promise<OtpChallenge> {
    // Checked before a code is sent: a user with no role could never be issued
    // a session anyway, and mailing them a code would only waste their time.
    if (!user.role || !user.roleId) throw unauthorized();
    const code = generateTemporaryPin();
    const minutes = this.config.LOGIN_OTP_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const challenge = await this.repo.createLoginOtp(
      user.id, hashPin(code, this.config.PIN_HMAC_SECRET), expiresAt);
    try {
      await emailService.sendLoginOtpEmail(user.email, user.firstName, code, minutes);
    } catch (error) {
      // Spend it: a code that was never delivered must not stay usable.
      await this.repo.consumeLoginOtp(challenge.id);
      console.error(`Could not send the sign-in code for ${user.id}:`, error);
      throw new AppError(502, "OTP_NOT_SENT",
        "Your password is right, but the code could not be emailed. Try again in a moment.");
    }
    /*
     * Development only, and it matters there: `NODE_ENV=development` sends
     * every mail to `DEV_EMAIL` instead of the account, so without this nobody
     * can sign in locally unless they can read that one inbox. It is gated on
     * `development` alone — a code in a production log would be a hole.
     */
    if (this.config.NODE_ENV === "development") {
      console.log(`[OTP:dev] ${user.email} → ${code} (expires ${expiresAt.toISOString()})`);
    }
    return { otpRequired: true, challengeId: challenge.id, email: maskedEmail(user.email), expiresAt };
  }

  /**
   * The code, which finishes the login and issues the session.
   *
   * Wrong codes are counted against the challenge, and the limit ends it: six
   * digits would otherwise be guessable by simply trying them all. Nothing
   * says which of "unknown", "expired", "spent" or "wrong" it was — a caller
   * who holds the challenge learns only whether the code was right.
   */
  async verifyLoginOtp(challengeId: string, code: string) {
    const challenge = await this.repo.findLoginOtp(challengeId);
    const refused = unauthorized("That code is wrong or has expired. Ask for a new one.");
    if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date()) throw refused;
    if (challenge.attempts >= this.config.LOGIN_OTP_MAX_ATTEMPTS) {
      await this.repo.consumeLoginOtp(challenge.id);
      throw refused;
    }
    if (!verifyPin(code, challenge.codeHash, this.config.PIN_HMAC_SECRET)) {
      const tried = await this.repo.countLoginOtpAttempt(challenge.id);
      // Spent on the last allowed try, so the next request cannot try again.
      if (tried.attempts >= this.config.LOGIN_OTP_MAX_ATTEMPTS) {
        await this.repo.consumeLoginOtp(challenge.id);
      }
      throw refused;
    }
    // Spent before the session is issued: a code is good for one sign-in.
    await this.repo.consumeLoginOtp(challenge.id);
    const user = await this.repo.findUserById(challenge.userId);
    this.ensureActive(user);
    return this.issue(user);
  }

  /**
   * Another code for the same login, when the first did not arrive.
   *
   * It takes the challenge rather than the password again, and writing the new
   * code spends the old one — so asking twice never leaves two codes working.
   */
  async resendLoginOtp(challengeId: string): Promise<OtpChallenge> {
    const challenge = await this.repo.findLoginOtp(challengeId);
    // An expired challenge is still worth resending from: the person is sitting
    // in front of the form having proved the password a minute ago. A *used*
    // one is not — that login is already finished.
    if (!challenge || challenge.usedAt) {
      throw unauthorized("That sign-in has expired. Enter your password again.");
    }
    const user = await this.repo.findUserById(challenge.userId);
    this.ensureActive(user);
    return this.startOtpChallenge(user);
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

/**
 * A signed-in session: the tokens the controller turns into cookies, and who
 * it belongs to. Taken from `verifyLoginOtp`, which is where a password login
 * now ends up.
 */
export type Session = Awaited<ReturnType<AuthService["verifyLoginOtp"]>>;

/** Whether a login answered with a challenge instead of a session. */
export const isOtpChallenge = (result: OtpChallenge | Session): result is OtpChallenge =>
  "otpRequired" in result;
