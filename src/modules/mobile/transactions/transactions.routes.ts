import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { parseInput } from "../../../shared/validation/index.js";
import { deviceAuthenticator } from "../auth/device-auth.js";
import { MobileTransactionsRepository } from "./transactions.repository.js";
import { transactionCodeParamsSchema } from "./transactions.schema.js";
import { MobileTransactionsService } from "./transactions.service.js";
import { CompanySettingsRepository } from "../../company-settings/company-settings.repository.js";

/**
 * Sales recorded by a POS (`GeneralTransaction`), in two steps:
 *
 * 1. `POST /` starts a sale at the pump and returns its `transactionCode`.
 * 2. `POST /:code/confirm` closes it once the fuel is delivered: the
 *    attendant signs with phone and PIN, the litres leave the tank and the
 *    payments are recorded.
 *
 * Both take multipart/form-data. A sale never served is cancelled with
 * `POST /:code/cancel`; once its receipt is printed, `PATCH /:code/print-status`
 * records it. Every route is for a provisioned device, and only
 * ever sees its own site's sales.
 */
const CONFIRM_LIMIT = {
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
  const repo = new MobileTransactionsRepository(app.prisma, app.config.PIN_HMAC_SECRET, app.config.MOBILE_SALE_TIMEOUT_MINUTES, app.config.STATIC_URL);
  // Receipts print the company profile kept on the web (Company Settings).
  const company = new CompanySettingsRepository(app.prisma);
  const service = new MobileTransactionsService(repo, () => company.receipt(app.config.STATIC_URL));

  // Every minute, sales left initiated past the timeout are cancelled and their cards freed.
  const sweep = setInterval(() => {
    repo.expire().then((count) => {
      if (count > 0) app.log.info({ count }, "Cancelled POS sales not confirmed in time");
    }).catch((error) => app.log.error({ err: error }, "Could not cancel overdue POS sales"));
  }, 60_000);
  sweep.unref();
  app.addHook("onClose", async () => clearInterval(sweep));
  const code = (params: unknown) => parseInput(transactionCodeParamsSchema, params).code;

  app.post("/", { preHandler: [authenticateDevice] }, async (request, reply) =>
    created(reply, await service.initiate(request)));

  // The site's 50 newest sales in one status (`?status=`, initiated by default).
  app.get("/", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.list(request)));

  app.get("/:code", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.find(request, code(request.params))));

  // The attendant's PIN is checked here, so tries are limited — per device
  // (its token) rather than per IP, as a station's POS often share one.
  app.post("/:code/confirm", { preHandler: [authenticateDevice], config: { rateLimit: CONFIRM_LIMIT } },
    async (request) => success(await service.confirm(request, code(request.params))));

  app.post("/:code/cancel", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.cancel(request, code(request.params))));

  // After printing (or failing to print) the receipt of a confirmed sale.
  app.patch("/:code/print-status", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.printStatus(request, code(request.params))));
};

export default routes;
