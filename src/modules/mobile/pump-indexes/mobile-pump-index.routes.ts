import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { parseInput } from "../../../shared/validation/index.js";
import { deviceAuthenticator } from "../auth/device-auth.js";
import { mobileAttendantSchema, recordPumpIndexesSchema } from "./mobile-pump-index.schema.js";
import { MobilePumpIndexService } from "./mobile-pump-index.service.js";

/**
 * The pump meters, read at the pump by the attendant who worked them.
 *
 * 1. `POST /current` — the attendant signs with phone and PIN and is told what
 *    they may read: the shifts the time table has them working now (or within
 *    the grace that follows one), the pumps and nozzles the rota gives them
 *    that day, each nozzle's opening figure, and any reading already taken.
 * 2. `POST /` — the counters of one shift, written together.
 *
 * Both are `POST`, including the one that only reads: a PIN belongs in a body,
 * not in a query string that lands in an access log.
 *
 * A reading arrives **pending**. Approving one — which freezes it for good —
 * stays on the web, because a POS has no way to correct what it sent.
 */
const PIN_LIMIT = {
  max: 20,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) => {
    const token = request.headers.authorization;
    return token ? `pos:${createHash("sha256").update(token).digest("hex")}` : request.ip;
  },
};

const routes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("device", null);
  const authenticateDevice = deviceAuthenticator(app, app.prisma);
  const service = new MobilePumpIndexService(
    app.prisma,
    app.config.PIN_HMAC_SECRET,
    app.config.MOBILE_PUMP_INDEX_GRACE_MINUTES,
  );

  app.post("/current", { preHandler: [authenticateDevice], config: { rateLimit: PIN_LIMIT } },
    async (request) => success(await service.current(
      parseInput(mobileAttendantSchema, request.body), request.device!.siteId)));

  app.post("/", { preHandler: [authenticateDevice], config: { rateLimit: PIN_LIMIT } },
    async (request, reply) => created(reply, await service.record(
      parseInput(recordPumpIndexesSchema, request.body), request.device!.siteId)));
};

export default routes;
