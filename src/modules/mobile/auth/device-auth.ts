import { createHmac } from "node:crypto";
import jwt, { type JWT } from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { createOpaqueToken, hashToken } from "../../../utils/crypto.js";
import { AppError, unauthorized } from "../../../utils/errors.js";

/** Who is calling, for a request authenticated as a POS device. */
export interface AuthDevice {
  deviceId: string;
  /** The device's site — the only site its requests may touch. */
  siteId: string;
  deviceUuid: string;
  deviceName: string;
}

/** What a device access token carries. */
interface DeviceTokenPayload {
  sub: string;
  siteId: string;
  /** Must match `SiteDevice.tokenVersion`; bumped on revoke and re-provisioning. */
  ver: number;
  typ: "pos-device";
}

const NAMESPACE = "device";
const TOKEN_TYPE = "pos-device";
/** `lastSeenAt` is written at most this often per device. */
const SEEN_INTERVAL_MS = 60_000;

/**
 * Device access tokens are signed by the app's own JWT plugin, registered a
 * second time under its own namespace with a key derived from `JWT_SECRET`.
 * Employee and device tokens therefore cannot stand in for one another.
 * Devices send theirs as `Authorization: Bearer …`; employees keep cookies.
 */
export async function registerDeviceJwt(app: FastifyInstance) {
  const secret = createHmac("sha256", app.config.JWT_SECRET).update("petrox:pos-device-tokens").digest("hex");
  await app.register(jwt, { namespace: NAMESPACE, secret });
}

function deviceJwt(app: FastifyInstance): JWT {
  return (app.jwt as unknown as Record<string, JWT>)[NAMESPACE];
}

/**
 * A fresh credential pair: a short-lived access token, and a long-lived
 * refresh token of which only the hash is kept. Issuing a pair replaces the
 * device's previous refresh token.
 */
export function issueDeviceCredentials(app: FastifyInstance, device: { id: string; siteId: string; tokenVersion: number }) {
  const payload: DeviceTokenPayload = { sub: device.id, siteId: device.siteId, ver: device.tokenVersion, typ: TOKEN_TYPE };
  const accessToken = deviceJwt(app).sign(payload as never, { expiresIn: app.config.ACCESS_TOKEN_TTL });
  const refreshToken = createOpaqueToken();
  const refreshTokenExpiresAt = new Date(Date.now() + app.config.MOBILE_DEVICE_REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  return {
    accessToken,
    accessTokenExpiresIn: app.config.ACCESS_TOKEN_TTL,
    refreshToken,
    refreshTokenExpiresAt,
    /** What the database keeps. */
    stored: { refreshTokenHash: hashToken(refreshToken), refreshTokenExpiresAt },
  };
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * The preHandler for POS routes. Verifies the access token, then checks the
 * device and its site in the database on every request, so a revoked device
 * or a switched-off site is shut out at once rather than when its token
 * expires. Sets `request.device`.
 */
export function deviceAuthenticator(app: FastifyInstance, db: PrismaClient) {
  return async function authenticateDevice(request: FastifyRequest) {
    const token = bearer(request);
    if (!token) throw unauthorized("Device authentication required");

    let payload: DeviceTokenPayload;
    try {
      payload = deviceJwt(app).verify<DeviceTokenPayload>(token);
    } catch (error) {
      // Expired is the everyday case: the POS refreshes and carries on.
      if ((error as { code?: string }).code === "FAST_JWT_EXPIRED") {
        throw new AppError(401, "DEVICE_TOKEN_EXPIRED", "Device token expired; refresh it");
      }
      throw unauthorized("Invalid device token");
    }
    if (payload.typ !== TOKEN_TYPE) throw unauthorized("Invalid or expired device token");

    const device = await db.siteDevice.findUnique({
      where: { id: payload.sub },
      select: { id: true, siteId: true, deviceUuid: true, deviceName: true, status: true, tokenVersion: true,
        lastSeenAt: true, site: { select: { status: true } } },
    });
    // Revoked, or registered again since this token was issued: refreshing
    // cannot help, the POS must stop and be provisioned with a new key.
    if (device?.status === "revoked" || (device && device.tokenVersion !== payload.ver)) {
      throw new AppError(401, "DEVICE_REVOKED", "This device has been revoked. Provision it again with a new key.");
    }
    if (!device || device.siteId !== payload.siteId) throw unauthorized("Invalid device token");
    if (device.site.status !== "active") throw new AppError(403, "SITE_INACTIVE", "This device's site is not active");

    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > SEEN_INTERVAL_MS) {
      await db.siteDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    request.device = { deviceId: device.id, siteId: device.siteId, deviceUuid: device.deviceUuid, deviceName: device.deviceName };
  };
}

/** The trusted site of the calling device. A different `siteId` sent by the client is refused. */
export function deviceSite(request: FastifyRequest, requestedSiteId?: string): string {
  if (!request.device) throw unauthorized("Device authentication required");
  if (requestedSiteId && requestedSiteId !== request.device.siteId) {
    throw new AppError(403, "SITE_MISMATCH", "This device can only access its own site");
  }
  return request.device.siteId;
}
