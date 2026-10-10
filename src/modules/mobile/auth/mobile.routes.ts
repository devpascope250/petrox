import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { parseInput } from "../../../shared/validation/index.js";
import { deviceAuthenticator, deviceSite, registerDeviceJwt } from "./device-auth.js";
import { MobileRepository } from "./mobile.repository.js";
import { MobileService } from "./mobile.service.js";
import {
  createProvisioningKeySchema, deviceParamsSchema, deviceSiteQuerySchema, keyParamsSchema,
  provisionDeviceSchema, refreshDeviceSchema, siteParamsSchema, syncQuerySchema,
} from "./mobile.schema.js";

/** Tighter than the app-wide limit: these are the doors a stolen or guessed key would knock on. */
const PROVISION_LIMIT = { rateLimit: { max: 5, timeWindow: "1 minute" } };
const REFRESH_LIMIT = { rateLimit: { max: 20, timeWindow: "1 minute" } };

/**
 * POS / mobile devices. Two audiences:
 *
 * - **Admins** (employee session, `mobile.devices.*` permissions, own site only
 *   unless super administrator) issue provisioning keys and manage devices.
 * - **Devices** provision themselves with a key, then authenticate with
 *   `Authorization: Bearer <device access token>`. Their site always comes
 *   from that credential, never from the request.
 *
 * See docs/mobile-pos-provisioning.md.
 */
const routes: FastifyPluginAsync = async (app) => {
  await registerDeviceJwt(app);
  app.decorateRequest("device", null);
  const repo = new MobileRepository(app.prisma);
  const service = new MobileService(repo, app);
  const authenticateDevice = deviceAuthenticator(app, app.prisma);

  /* ---- Admin: provisioning keys ---- */
  app.post("/sites/:siteId/provisioning-keys", { preHandler: [app.authenticate, app.authorize("mobile.devices.create")] }, async (request, reply) =>
    created(reply, await service.createKey(
      parseInput(siteParamsSchema, request.params).siteId,
      parseInput(createProvisioningKeySchema, request.body ?? {}),
      request.contextUser!, request.log,
    )));
  app.get("/sites/:siteId/provisioning-keys", { preHandler: [app.authenticate, app.authorize("mobile.devices.read")] }, async (request) =>
    success(await service.listKeys(parseInput(siteParamsSchema, request.params).siteId, request.contextUser!)));
  app.post("/provisioning-keys/:keyId/revoke", { preHandler: [app.authenticate, app.authorize("mobile.devices.edit")] }, async (request) =>
    success(await service.revokeKey(parseInput(keyParamsSchema, request.params).keyId, request.contextUser!, request.log)));

  /* ---- Admin: devices ---- */
  app.get("/sites/:siteId/devices", { preHandler: [app.authenticate, app.authorize("mobile.devices.read")] }, async (request) =>
    success(await service.listDevices(parseInput(siteParamsSchema, request.params).siteId, request.contextUser!)));
  app.post("/devices/:deviceId/revoke", { preHandler: [app.authenticate, app.authorize("mobile.devices.edit")] }, async (request) =>
    success(await service.revokeDevice(parseInput(deviceParamsSchema, request.params).deviceId, request.contextUser!, request.log)));

  /* ---- Device: provisioning and credentials (no session yet) ---- */
  app.post("/provision", { config: PROVISION_LIMIT }, async (request, reply) =>
    created(reply, await service.provision(parseInput(provisionDeviceSchema, request.body), request.log)));
  app.post("/auth/refresh", { config: REFRESH_LIMIT }, async (request) =>
    success(await service.refresh(parseInput(refreshDeviceSchema, request.body).refreshToken, request.log)));

  /* ---- Device: authenticated ---- */
  app.get("/me", { preHandler: [authenticateDevice] }, async (request) => {
    deviceSite(request);
    const { device, site } = await service.bootstrap(request.device!.deviceId);
    return success({ device, site });
  });
  app.get("/bootstrap", { preHandler: [authenticateDevice] }, async (request) => {
    // A siteId may be sent, but only to be checked: the device's own site is used.
    deviceSite(request, parseInput(deviceSiteQuerySchema, request.query).siteId);
    return success(await service.bootstrap(request.device!.deviceId));
  });
  /**
   * Has the site data changed since the POS stored it? Send the `version` it
   * holds; the answer is `changed: false`, or the new data and version. The
   * version also goes out as an ETag, so `If-None-Match` gets a 304.
   */
  app.get("/sync", { preHandler: [authenticateDevice] }, async (request, reply) => {
    const query = parseInput(syncQuerySchema, request.query);
    deviceSite(request, query.siteId);
    const ifNoneMatch = request.headers["if-none-match"]?.replace(/^W\//, "").replace(/"/g, "");
    const result = await service.sync(request.device!.deviceId, query.version ?? ifNoneMatch);
    reply.header("ETag", `"${result.version}"`).header("Cache-Control", "no-cache");
    if (!result.changed && !query.version && ifNoneMatch) return reply.code(304).send();
    return success(result);
  });
};

export default routes;
