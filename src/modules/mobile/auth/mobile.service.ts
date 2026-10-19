import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { AuthUser } from "../../../shared/auth/context-user.js";
import { hashToken } from "../../../utils/crypto.js";
import { AppError, BusinessError, unauthorized } from "../../../utils/errors.js";
import { issueDeviceCredentials } from "./device-auth.js";
import { audit } from "./mobile-audit.js";
import { assertCanManageSite } from "./mobile-scope.js";
import { MobileRepository, type KeyRow } from "./mobile.repository.js";
import type { CreateProvisioningKeyInput, ProvisionDeviceInput } from "./mobile.schema.js";
import { generateProvisioningKey, hashProvisioningKey } from "./provisioning-key.js";

type KeyStatus = "active" | "used" | "expired" | "revoked";

function keyStatus(key: KeyRow, now = new Date()): KeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.usedAt) return "used";
  if (key.expiresAt <= now) return "expired";
  return "active";
}

/** A key as an admin sees it: its state and history — never its hash. */
function presentKey(key: KeyRow) {
  return { ...key, status: keyStatus(key) };
}

export class MobileService {

  constructor(private repo: MobileRepository, private app: FastifyInstance) {
  }

  /* ------------------------------------------------------------------ */
  /* Admin                                                               */
  /* ------------------------------------------------------------------ */

  private async manageableSite(actor: AuthUser, siteId: string) {
    assertCanManageSite(actor, siteId);
    const site = await this.repo.findSite(siteId);
    if (!site) throw new AppError(404, "RESOURCE_NOT_FOUND", "Site not found");
    return site;
  }

  /** Returns the raw key once. Only its hash is stored, and it is never logged. */
  async createKey(siteId: string, input: CreateProvisioningKeyInput, actor: AuthUser, log: FastifyBaseLogger) {
    const site = await this.manageableSite(actor, siteId);
    if (site.status !== "active") throw new BusinessError("SITE_INACTIVE", `${site.name} is not active`);
    const max = this.app.config.MOBILE_PROVISIONING_KEY_MAX_MINUTES;
    if (input.expiresInMinutes > max) {
      throw new AppError(400, "EXPIRY_TOO_LONG", `A provisioning key can last at most ${max} minutes`);
    }
    const key = generateProvisioningKey();
    const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);
    const row = await this.repo.createKey({ siteId, keyHash: hashProvisioningKey(key), expiresAt, createdBy: actor.userId });
    audit(log, "MOBILE_PROVISIONING_KEY_CREATED", { keyId: row.id, siteId, userId: actor.userId, expiresAt: expiresAt.toISOString() });
    return { ...presentKey(row), key, site: { id: site.id, name: site.name } };
  }

  async listKeys(siteId: string, actor: AuthUser) {
    await this.manageableSite(actor, siteId);
    return (await this.repo.listKeys(siteId)).map(presentKey);
  }

  async revokeKey(keyId: string, actor: AuthUser, log: FastifyBaseLogger) {
    const key = await this.repo.findKey(keyId);
    assertCanManageSite(actor, key.siteId);
    if (!(await this.repo.revokeKey(keyId))) {
      throw new BusinessError("KEY_NOT_REVOKABLE", `This key is ${keyStatus(key)} and can no longer be revoked`);
    }
    audit(log, "MOBILE_PROVISIONING_KEY_REVOKED", { keyId, siteId: key.siteId, userId: actor.userId });
    return presentKey(await this.repo.findKey(keyId));
  }

  async listDevices(siteId: string, actor: AuthUser) {
    await this.manageableSite(actor, siteId);
    return this.repo.listDevices(siteId);
  }

  async revokeDevice(deviceId: string, actor: AuthUser, log: FastifyBaseLogger) {
    const device = await this.repo.findDevice(deviceId);
    assertCanManageSite(actor, device.siteId);
    if (device.status === "revoked") throw new BusinessError("DEVICE_ALREADY_REVOKED", `${device.deviceName} is already revoked`);
    const revoked = await this.repo.revokeDevice(deviceId, actor.userId);
    audit(log, "MOBILE_DEVICE_REVOKED", { deviceId, siteId: device.siteId, userId: actor.userId });
    return revoked;
  }

  /* ------------------------------------------------------------------ */
  /* Device                                                              */
  /* ------------------------------------------------------------------ */

  private credentials = (device: { id: string; siteId: string; tokenVersion: number }) =>
    issueDeviceCredentials(this.app, device);

  /** Registers the calling device and hands it its credentials and what it needs to start. */
  async provision(input: ProvisionDeviceInput, log: FastifyBaseLogger) {
    let result;
    try {
      result = await this.repo.provision(
        { keyHash: hashProvisioningKey(input.provisioningKey), deviceUuid: input.deviceUuid, deviceName: input.deviceName },
        this.credentials,
      );
    } catch (error) {
      audit(log, "MOBILE_PROVISIONING_REJECTED", { reason: (error as { code?: string }).code ?? "ERROR" });
      throw error;
    }
    const { issued } = result;
    audit(log, "MOBILE_DEVICE_PROVISIONED", { deviceId: result.deviceId, keyId: result.keyId, reprovisioned: String(result.reprovisioned) });
    return {
      ...(await this.bootstrap(result.deviceId)),
      authentication: {
        tokenType: "Bearer",
        accessToken: issued.accessToken,
        accessTokenExpiresIn: issued.accessTokenExpiresIn,
        refreshToken: issued.refreshToken,
        refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
      },
    };
  }

  /** A new credential pair for a device's refresh token; the old one stops working. */
  async refresh(refreshToken: string, log: FastifyBaseLogger) {
    const rotated = await this.repo.rotateRefreshToken(hashToken(refreshToken), this.credentials);
    // Unknown, used already, expired, or cleared by a revoke: none can be refreshed.
    if (!rotated) throw new AppError(401, "DEVICE_REFRESH_INVALID", "This device must be provisioned again with a new key");
    audit(log, "MOBILE_DEVICE_AUTHENTICATED", { deviceId: rotated.deviceId });
    const { issued } = rotated;
    return {
      tokenType: "Bearer",
      accessToken: issued.accessToken,
      accessTokenExpiresIn: issued.accessTokenExpiresIn,
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
    };
  }

  /**
   * The site data a POS keeps on the device: the site, its equipment — pumps,
   * their displays and nozzles — and the accounts a sale's money may go into,
   * with a `version` fingerprinting all of it, so `/mobile/sync` can tell the
   * POS when any of it changes.
   */
  private async snapshot(deviceId: string) {
    const { site, ...device } = await this.repo.deviceWithSite(deviceId);
    const [equipment, accounts] = await Promise.all([
      this.repo.siteEquipment(site.id),
      this.repo.paymentAccounts(site.id),
    ]);
    // Every list arrives in a fixed order, so equal data always gives the same version.
    const version = createHash("sha256").update(JSON.stringify({ site, equipment, accounts })).digest("hex").slice(0, 32);
    return { device, site, equipment, accounts, version };
  }

  /**
   * Everything a POS needs to start selling at its site: the device, the
   * server's clock, and the site data with its `version`. Always the device's
   * own site, taken from its credential.
   */
  async bootstrap(deviceId: string) {
    const { device, site, equipment, accounts, version } = await this.snapshot(deviceId);
    return { device, site, equipment, accounts, serverTime: new Date().toISOString(), version };
  }

  /**
   * Whether the site data the POS holds is still current. With the version the
   * POS last received: `{ changed: false }` when nothing moved, otherwise
   * everything provisioning gave it — device, site, equipment, accounts,
   * server time and version, built by `bootstrap` so the two cannot drift
   * apart — to replace
   * the local copy whole. Only the credentials are not sent again.
   */
  async sync(deviceId: string, knownVersion?: string) {
    const data = await this.bootstrap(deviceId);
    if (knownVersion === data.version) {
      return { changed: false as const, version: data.version, serverTime: data.serverTime };
    }
    return { changed: true as const, ...data };
  }
}
