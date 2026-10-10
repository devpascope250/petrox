import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
} from "../../../../prisma/generated/prisma/client.js";
import { AppError, ConflictError, NotFoundError } from "../../../utils/errors.js";

const person = {
  select: { id: true, firstName: true, lastName: true },
} as const;

/** Never selects `keyHash`. */
const keySelect = {
  id: true,
  siteId: true,
  expiresAt: true,
  usedAt: true,
  revokedAt: true,
  createdAt: true,
  user: person,
  usedByDevice: { select: { id: true, deviceName: true, deviceUuid: true } },
} satisfies Prisma.SiteProvisioningKeySelect;

/** Never selects the refresh token hash or the token version. */
const deviceSelect = {
  id: true,
  siteId: true,
  deviceUuid: true,
  deviceName: true,
  status: true,
  lastSeenAt: true,
  provisionedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  revoker: person,
} satisfies Prisma.SiteDeviceSelect;

/** What a POS needs to know about its site — nothing administrative. */
export const siteForDevice = {
  select: { id: true, name: true, address: true, phone: true, email: true },
} as const;

/** Said for every provisioning failure, so a guess learns nothing about which keys exist. */
export const invalidProvisioningKey = () =>
  new AppError(
    401,
    "INVALID_PROVISIONING_KEY",
    "Invalid or expired provisioning key",
  );

export const deviceAlreadyRegistered = () =>
  new ConflictError(
    "DEVICE_ALREADY_REGISTERED",
    "This device is already registered. An administrator must revoke it before it can be provisioned again.",
  );

export type KeyRow = Prisma.SiteProvisioningKeyGetPayload<{
  select: typeof keySelect;
}>;

/** What the new device's credentials are built from, before it exists. */
export interface NewCredentials {
  stored: { refreshTokenHash: string; refreshTokenExpiresAt: Date };
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

export class MobileRepository {
  constructor(private db: PrismaClient) {}

  findSite(siteId: string) {
    return this.db.tblSite.findUnique({
      where: { id: siteId },
      select: { id: true, name: true, status: true },
    });
  }

  createKey(data: {
    siteId: string;
    keyHash: string;
    expiresAt: Date;
    createdBy: string;
  }) {
    return this.db.siteProvisioningKey.create({ data, select: keySelect });
  }

  /** The most recent keys of a site, newest first. */
  listKeys(siteId: string, take = 50) {
    return this.db.siteProvisioningKey.findMany({
      where: { siteId },
      select: keySelect,
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async findKey(id: string) {
    const key = await this.db.siteProvisioningKey.findUnique({
      where: { id },
      select: keySelect,
    });
    if (!key) throw new NotFoundError("Provisioning key");
    return key;
  }

  /** Only a key that is still unused can be revoked; returns whether it was. */
  async revokeKey(id: string) {
    const { count } = await this.db.siteProvisioningKey.updateMany({
      where: { id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  listDevices(siteId: string) {
    return this.db.siteDevice.findMany({
      where: { siteId },
      select: deviceSelect,
      orderBy: [{ status: "asc" }, { provisionedAt: "desc" }],
    });
  }

  async findDevice(id: string) {
    const device = await this.db.siteDevice.findUnique({
      where: { id },
      select: deviceSelect,
    });
    if (!device) throw new NotFoundError("Device");
    return device;
  }

  /**
   * Revokes a device: its status, the time and who did it, its refresh token
   * cleared and its token version bumped so no token issued before keeps working.
   */
  revokeDevice(id: string, userId: string) {
    return this.db.siteDevice.update({
      where: { id },
      data: {
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: userId,
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
        tokenVersion: { increment: 1 },
      },
      select: deviceSelect,
    });
  }

  /**
   * Registers a device with a provisioning key, all or nothing:
   *
   * 1. the key is claimed with one conditional UPDATE — unused, unrevoked and
   *    unexpired — so of two requests racing with the same key only one can
   *    succeed;
   * 2. the site must be active;
   * 3. the device is created, or a revoked device with the same UUID is
   *    registered again (to this site, with a new token version);
   * 4. the key records which device used it.
   *
   * Any failure rolls the key back to unused.
   */
  provision<T extends NewCredentials>(
    input: { keyHash: string; deviceUuid: string; deviceName: string },
    credentials: (device: {
      id: string;
      siteId: string;
      tokenVersion: number;
    }) => T,
  ) {
    return this.db
      .$transaction(async (tx) => {
        const now = new Date();
        const key = await tx.siteProvisioningKey.findUnique({
          where: { keyHash: input.keyHash },
          select: { id: true, siteId: true },
        });
        if (!key) throw invalidProvisioningKey();
        const claimed = await tx.siteProvisioningKey.updateMany({
          where: {
            id: key.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) throw invalidProvisioningKey();

        const site = await tx.tblSite.findUnique({
          where: { id: key.siteId },
          select: { status: true },
        });
        if (!site || site.status !== "active") throw invalidProvisioningKey();

        const existing = await tx.siteDevice.findUnique({
          where: { deviceUuid: input.deviceUuid },
          select: { id: true, status: true, tokenVersion: true },
        });
        if (existing?.status === "active") throw deviceAlreadyRegistered();

        const identity = existing
          ? {
              id: existing.id,
              siteId: key.siteId,
              tokenVersion: existing.tokenVersion + 1,
            }
          : { id: randomUUID(), siteId: key.siteId, tokenVersion: 0 };
        const issued = credentials(identity);
        const fields = {
          siteId: key.siteId,
          deviceName: input.deviceName,
          status: "active" as const,
          provisionedAt: now,
          revokedAt: null,
          revokedBy: null,
          lastSeenAt: now,
          tokenVersion: identity.tokenVersion,
          ...issued.stored,
        };
        const device = existing
          ? await tx.siteDevice.update({
              where: { id: existing.id },
              data: fields,
              select: { id: true },
            })
          : await tx.siteDevice.create({
              data: {
                id: identity.id,
                deviceUuid: input.deviceUuid,
                ...fields,
              },
              select: { id: true },
            });

        await tx.siteProvisioningKey.update({
          where: { id: key.id },
          data: { usedByDeviceId: device.id },
        });
        return {
          deviceId: device.id,
          keyId: key.id,
          reprovisioned: Boolean(existing),
          issued,
        };
      })
      .catch((error: unknown) => {
        // Two keys racing to register the same new device: the unique UUID stops the second.
        if (isUniqueViolation(error)) throw deviceAlreadyRegistered();
        throw error;
      });
  }

  /**
   * Swaps a device's refresh token for a new pair. The swap is conditional on
   * the old token still being the current one, so a token can be used once.
   */
  async rotateRefreshToken<T extends NewCredentials>(
    refreshTokenHash: string,
    credentials: (device: {
      id: string;
      siteId: string;
      tokenVersion: number;
    }) => T,
  ) {
    const device = await this.db.siteDevice.findUnique({
      where: { refreshTokenHash },
      select: {
        id: true,
        siteId: true,
        status: true,
        tokenVersion: true,
        refreshTokenExpiresAt: true,
        site: { select: { status: true } },
      },
    });
    if (
      !device ||
      device.status !== "active" ||
      !device.refreshTokenExpiresAt ||
      device.refreshTokenExpiresAt <= new Date()
    ) {
      return null;
    }
    if (device.site.status !== "active")
      throw new AppError(
        403,
        "SITE_INACTIVE",
        "This device's site is not active",
      );
    const issued = credentials(device);
    const { count } = await this.db.siteDevice.updateMany({
      where: { id: device.id, refreshTokenHash, status: "active" },
      data: { ...issued.stored, lastSeenAt: new Date() },
    });
    return count === 1 ? { deviceId: device.id, issued } : null;
  }

  /** The device and its site, as the POS sees them. */
  deviceWithSite(id: string) {
    return this.db.siteDevice.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        deviceUuid: true,
        deviceName: true,
        status: true,
        provisionedAt: true,
        site: siteForDevice,
      },
    });
  }

  /**
   * A site's active equipment, as the POS lays it out: each pump with its
   * displays, and each display with its nozzles — and for every nozzle, the
   * tank it draws from and the product in it. Switched-off pumps, displays,
   * nozzles and tanks are left out. Every list is in a fixed order, so the
   * same equipment always reads the same.
   */
  async siteEquipment(siteId: string) {
    const pumps = await this.db.tblPump.findMany({
      where: { siteId, status: "active" },
      select: {
        id: true, name: true,
        displays: {
          where: { status: "active" },
          select: {
            id: true, name: true, code: true,
            nozzles: {
              where: { status: "active", cuve: { status: "active" } },
              select: {
                id: true, name: true, nozzleCode: true,
                cuve: { select: { id: true, name: true, item: { select: { id: true, name: true } } } },
              },
              orderBy: [{ name: "asc" }, { id: "asc" }],
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { pumps };
  }
}
