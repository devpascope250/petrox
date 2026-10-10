import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import type { AuthUser } from "../src/shared/auth/context-user.js";
import {
  generateProvisioningKey, hashProvisioningKey, normalizeProvisioningKey,
} from "../src/modules/mobile/auth/provisioning-key.js";
import { createProvisioningKeySchema, provisionDeviceSchema } from "../src/modules/mobile/auth/mobile.schema.js";
import { assertCanManageSite } from "../src/modules/mobile/auth/mobile-scope.js";
import { deviceAuthenticator, deviceSite, issueDeviceCredentials, registerDeviceJwt } from "../src/modules/mobile/auth/device-auth.js";
import { MobileService } from "../src/modules/mobile/auth/mobile.service.js";
import { MobileRepository } from "../src/modules/mobile/auth/mobile.repository.js";

const SITE_A = "00000000-0000-4000-8000-00000000000a";
const SITE_B = "00000000-0000-4000-8000-00000000000b";
const config = {
  JWT_SECRET: "x".repeat(40), ACCESS_TOKEN_TTL: "15m",
  MOBILE_PROVISIONING_KEY_MAX_MINUTES: 30, MOBILE_DEVICE_REFRESH_TOKEN_TTL_DAYS: 90,
} as AppConfig;
const admin = { userId: "admin", position: "superAdmin", siteId: null } as unknown as AuthUser;
const manager = { userId: "mgr", position: "siteManager", siteId: SITE_A } as unknown as AuthUser;

async function jwtApp() {
  const app = Fastify();
  app.decorate("config", config);
  await registerDeviceJwt(app);
  await app.ready();
  return app;
}

describe("provisioning keys", () => {
  it("are random, readable and well-formed", () => {
    const keys = new Set(Array.from({ length: 200 }, generateProvisioningKey));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^IK-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("hash the same however the key is typed, and never contain it", () => {
    const key = "IK-7GQ2-M9XA-4KTD";
    const hash = hashProvisioningKey(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("7GQ2");
    expect(hashProvisioningKey("ik 7gq2 m9xa 4ktd")).toBe(hash);
    expect(hashProvisioningKey("7GQ2-M9XA-4KTD")).toBe(hash);
    // O reads as 0, I and L as 1, so a misread character still matches.
    expect(normalizeProvisioningKey("qk-0oil-1111-0000")).toBe("001111110000");
    expect(hashProvisioningKey("IK-7GQ2-M9XA-4KTE")).not.toBe(hash);
  });

  it("validate expiry and the provisioning request", () => {
    expect(createProvisioningKeySchema.parse({})).toEqual({ expiresInMinutes: 10 });
    expect(createProvisioningKeySchema.safeParse({ expiresInMinutes: 0 }).success).toBe(false);
    expect(createProvisioningKeySchema.safeParse({ expiresInMinutes: 5.5 }).success).toBe(false);
    const ok = { provisioningKey: "IK-7GQ2-M9XA-4KTD", deviceUuid: "a1b2c3d4-device", deviceName: "POS 01" };
    expect(provisionDeviceSchema.safeParse(ok).success).toBe(true);
    expect(provisionDeviceSchema.safeParse({ ...ok, siteId: SITE_B }).success).toBe(false);
    expect(provisionDeviceSchema.safeParse({ ...ok, deviceUuid: "short" }).success).toBe(false);
    expect(provisionDeviceSchema.safeParse({ ...ok, deviceUuid: "has spaces in it" }).success).toBe(false);
    expect(provisionDeviceSchema.safeParse({ ...ok, deviceName: "x".repeat(81) }).success).toBe(false);
  });
});

describe("admin authorization", () => {
  it("lets a super admin manage any site and a site manager only his own", () => {
    expect(() => assertCanManageSite(admin, SITE_B)).not.toThrow();
    expect(() => assertCanManageSite(manager, SITE_A)).not.toThrow();
    expect(() => assertCanManageSite(manager, SITE_B)).toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(() => assertCanManageSite({ ...manager, position: "clientAdmin" } as AuthUser, SITE_A)).toThrow();
  });

  it("creates a key: stores only the hash, returns the key once, caps the expiry", async () => {
    const createKey = vi.fn(async (data) => ({ id: "k1", siteId: data.siteId, expiresAt: data.expiresAt, usedAt: null,
      revokedAt: null, createdAt: new Date(), user: null, usedByDevice: null }));
    const repo = { findSite: vi.fn().mockResolvedValue({ id: SITE_A, name: "A", status: "active" }), createKey };
    const log = { info: vi.fn() };
    const service = new MobileService(repo as never, { config, prisma: {} } as never);
    const result = await service.createKey(SITE_A, { expiresInMinutes: 10 }, manager, log as never);
    expect(result.status).toBe("active");
    expect(createKey.mock.calls[0][0].keyHash).toBe(hashProvisioningKey(result.key));
    expect(JSON.stringify(createKey.mock.calls[0][0])).not.toContain(result.key);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(result.key);
    await expect(service.createKey(SITE_A, { expiresInMinutes: 31 }, manager, log as never))
      .rejects.toMatchObject({ code: "EXPIRY_TOO_LONG" });
    await expect(service.createKey(SITE_B, { expiresInMinutes: 10 }, manager, log as never))
      .rejects.toMatchObject({ statusCode: 403 });
    repo.findSite.mockResolvedValueOnce({ id: SITE_A, name: "A", status: "inactive" });
    await expect(service.createKey(SITE_A, { expiresInMinutes: 10 }, admin, log as never))
      .rejects.toMatchObject({ code: "SITE_INACTIVE" });
  });

  it("refuses to revoke another site's device", async () => {
    const repo = { findDevice: vi.fn().mockResolvedValue({ id: "d", siteId: SITE_B, status: "active", deviceName: "POS" }), revokeDevice: vi.fn() };
    const service = new MobileService(repo as never, { config, prisma: {} } as never);
    await expect(service.revokeDevice("d", manager, { info: vi.fn() } as never)).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.revokeDevice).not.toHaveBeenCalled();
  });
});

describe("provisioning transaction", () => {
  function txDb(overrides: Record<string, unknown> = {}) {
    const tx = {
      siteProvisioningKey: {
        findUnique: vi.fn().mockResolvedValue({ id: "k1", siteId: SITE_A }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      tblSite: { findUnique: vi.fn().mockResolvedValue({ status: "active" }) },
      siteDevice: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }) => ({ id: data.id })),
        update: vi.fn(),
      },
      ...overrides,
    };
    return { tx, db: { $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) } };
  }
  const creds = () => ({ stored: { refreshTokenHash: "h", refreshTokenExpiresAt: new Date() } });
  const input = { keyHash: "hash", deviceUuid: "device-uuid-1", deviceName: "POS 01" };

  it("claims the key with one conditional update and records the device", async () => {
    const { tx, db } = txDb();
    const result = await new MobileRepository(db as never).provision(input, creds);
    expect(tx.siteProvisioningKey.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "k1", usedAt: null, revokedAt: null, expiresAt: { gt: expect.any(Date) } }),
    }));
    expect(tx.siteDevice.create).toHaveBeenCalled();
    expect(tx.siteProvisioningKey.update).toHaveBeenCalledWith({ where: { id: "k1" }, data: { usedByDeviceId: result.deviceId } });
  });

  it("gives the same generic error for unknown, used/expired/revoked keys and inactive sites", async () => {
    for (const setup of [
      (tx: ReturnType<typeof txDb>["tx"]) => tx.siteProvisioningKey.findUnique.mockResolvedValue(null),
      (tx: ReturnType<typeof txDb>["tx"]) => tx.siteProvisioningKey.updateMany.mockResolvedValue({ count: 0 }),
      (tx: ReturnType<typeof txDb>["tx"]) => tx.tblSite.findUnique.mockResolvedValue({ status: "inactive" }),
    ]) {
      const { tx, db } = txDb();
      setup(tx);
      await expect(new MobileRepository(db as never).provision(input, creds))
        .rejects.toMatchObject({ code: "INVALID_PROVISIONING_KEY", message: "Invalid or expired provisioning key" });
      expect(tx.siteDevice.create).not.toHaveBeenCalled();
    }
  });

  it("refuses an active device, and maps a racing duplicate UUID to the same error", async () => {
    const active = txDb();
    active.tx.siteDevice.findUnique.mockResolvedValue({ id: "d", status: "active", tokenVersion: 0 });
    await expect(new MobileRepository(active.db as never).provision(input, creds)).rejects.toMatchObject({ code: "DEVICE_ALREADY_REGISTERED" });
    const race = txDb();
    race.tx.siteDevice.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(new MobileRepository(race.db as never).provision(input, creds)).rejects.toMatchObject({ code: "DEVICE_ALREADY_REGISTERED" });
  });

  it("re-provisions a revoked device with a new token version", async () => {
    const { tx, db } = txDb();
    tx.siteDevice.findUnique.mockResolvedValue({ id: "d", status: "revoked", tokenVersion: 3 });
    tx.siteDevice.update.mockResolvedValue({ id: "d" });
    const seen: number[] = [];
    await new MobileRepository(db as never).provision(input, (d) => { seen.push(d.tokenVersion); return creds(); });
    expect(seen).toEqual([4]);
    expect(tx.siteDevice.update.mock.calls[0][0].data).toMatchObject({ status: "active", revokedAt: null, tokenVersion: 4 });
  });
});

describe("device authentication and site isolation", () => {
  const device = { id: "dev-1", siteId: SITE_A, deviceUuid: "u", deviceName: "POS", status: "active", tokenVersion: 2,
    lastSeenAt: new Date(), site: { status: "active" } };
  const request = (token?: string) => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, device: null }) as unknown as FastifyRequest;

  it("accepts a valid device token and resolves the device's site", async () => {
    const app = await jwtApp();
    const { accessToken, refreshToken, stored } = issueDeviceCredentials(app, device);
    expect(stored.refreshTokenHash).not.toContain(refreshToken);
    const db = { siteDevice: { findUnique: vi.fn().mockResolvedValue(device), update: vi.fn() } };
    const req = request(accessToken);
    await deviceAuthenticator(app, db as never)(req);
    expect(req.device).toMatchObject({ deviceId: "dev-1", siteId: SITE_A });
    expect(deviceSite(req)).toBe(SITE_A);
    expect(deviceSite(req, SITE_A)).toBe(SITE_A);
    expect(() => deviceSite(req, SITE_B)).toThrow(expect.objectContaining({ code: "SITE_MISMATCH" }));
    await app.close();
  });

  it("rejects revoked devices, old token versions, other devices' tokens and bad tokens", async () => {
    const app = await jwtApp();
    const { accessToken } = issueDeviceCredentials(app, device);
    for (const stored of [{ ...device, status: "revoked" }, { ...device, tokenVersion: 3 }, { ...device, siteId: SITE_B }, null]) {
      const db = { siteDevice: { findUnique: vi.fn().mockResolvedValue(stored), update: vi.fn() } };
      await expect(deviceAuthenticator(app, db as never)(request(accessToken))).rejects.toMatchObject({ statusCode: 401 });
    }
    const db = { siteDevice: { findUnique: vi.fn().mockResolvedValue(device), update: vi.fn() } };
    for (const token of [undefined, "not-a-jwt", `${accessToken}x`]) {
      await expect(deviceAuthenticator(app, db as never)(request(token))).rejects.toMatchObject({ statusCode: 401 });
    }
    await app.close();
  });

  it("does not accept a token signed with the employee key", async () => {
    const app = await jwtApp();
    const employee = Fastify();
    const jwt = (await import("@fastify/jwt")).default;
    await employee.register(jwt, { secret: config.JWT_SECRET });
    await employee.ready();
    const forged = employee.jwt.sign({ sub: "dev-1", siteId: SITE_A, ver: 2, typ: "pos-device" } as never);
    const db = { siteDevice: { findUnique: vi.fn().mockResolvedValue(device), update: vi.fn() } };
    await expect(deviceAuthenticator(app, db as never)(request(forged))).rejects.toMatchObject({ statusCode: 401 });
    expect(db.siteDevice.findUnique).not.toHaveBeenCalled();
    await app.close();
    await employee.close();
  });
});

describe("site data sync", () => {
  function service(equipment: { pumps: unknown[] }) {
    const repo = {
      deviceWithSite: vi.fn().mockResolvedValue({ id: "d", deviceUuid: "u", deviceName: "POS", status: "active",
        provisionedAt: new Date(), site: { id: SITE_A, name: "A", address: null, phone: null, email: null } }),
      siteEquipment: vi.fn().mockResolvedValue(equipment),
    };
    return { svc: new MobileService(repo as never, { config, prisma: {} } as never), repo };
  }
  const nozzle = { id: "n1", name: "Nozzle 1", nozzleCode: "NZ1", cuve: { id: "c", name: "TANK1", item: { id: "i", name: "AGO" } } };
  const base = { pumps: [{ id: "p", name: "PUMP1", displays: [{ id: "d1", name: "Display 1", code: "D1", nozzles: [nozzle] }] }] };

  it("sends the site's pumps, displays and nozzles, and answers 'unchanged' for the current version", async () => {
    const { svc, repo } = service(base);
    const first = await svc.bootstrap("d");
    expect(repo.siteEquipment).toHaveBeenCalledWith(SITE_A);
    expect(first.version).toMatch(/^[0-9a-f]{32}$/);
    expect(first.equipment.pumps[0]).toMatchObject({ name: "PUMP1", displays: [{ code: "D1", nozzles: [{ nozzleCode: "NZ1" }] }] });
    expect(await svc.sync("d", first.version)).toEqual({ changed: false, version: first.version, serverTime: expect.any(String) });
    expect(await svc.sync("d")).toMatchObject({ changed: true, version: first.version, site: { id: SITE_A }, equipment: base });
  });

  it("changes version when the equipment changes", async () => {
    const v0 = (await service(base).svc.bootstrap("d")).version;
    expect((await service(base).svc.sync("d", v0)).changed).toBe(false);
    const renamed = { pumps: [{ ...base.pumps[0], displays: [{ ...base.pumps[0].displays[0], nozzles: [{ ...nozzle, name: "Nozzle A" }] }] }] };
    const changed = await service(renamed).svc.sync("d", v0);
    expect(changed.changed).toBe(true);
    expect(changed.version).not.toBe(v0);
    expect((await service({ pumps: [] }).svc.sync("d", v0)).changed).toBe(true);
  });
});
