import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { created, success } from "../../../shared/http/index.js";
import { parseInput } from "../../../shared/validation/index.js";
import { deviceAuthenticator } from "../auth/device-auth.js";
import { CompanySettingsRepository } from "../../company-settings/company-settings.repository.js";
import { MobileTransactionsRepository } from "../transactions/transactions.repository.js";
import { attendantBy } from "../transactions/sale-rules.js";
import { CouponSaleRepository } from "./coupon-sale.repository.js";
import { clientParamsSchema, couponSaleCodeSchema } from "./coupon-sale.schema.js";
import { CouponSaleService } from "./coupon-sale.service.js";

/**
 * Fuel sales paid with a client's coupons — POS sales like any other, read,
 * listed and printed through `/mobile/transactions`, but with their own steps:
 *
 * 1. `GET /clients` — clients with coupons they can spend;
 * 2. `POST /clients/:clientId/verify` — the client's PIN, and what their coupons can pay;
 * 3. `POST /` — start the sale: client and PIN, the fuel, the amount, the
 *    picture of the pump display (required). It never lapses;
 * 4. `POST /:code/confirm` — the client, the coupons scanned and the
 *    attendant's phone and PIN; everything is recorded, or nothing;
 * 5. `POST /:code/cancel` — drop one never confirmed.
 *
 * Every route is for a provisioned device, and only sees its own site's sales.
 */
const PIN_LIMIT = {
  max: 20,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) => {
    const token = request.headers.authorization;
    return token ? `pos-coupon:${createHash("sha256").update(token).digest("hex")}` : request.ip;
  },
};

const routes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("device", null);
  const authenticateDevice = deviceAuthenticator(app, app.prisma);
  const sales = new MobileTransactionsRepository(app.prisma, app.config.PIN_HMAC_SECRET, app.config.MOBILE_SALE_TIMEOUT_MINUTES, app.config.STATIC_URL);
  const company = new CompanySettingsRepository(app.prisma);
  const service = new CouponSaleService(
    new CouponSaleRepository(app.prisma, app.config.PIN_HMAC_SECRET, sales),
    (phone, pin, siteId) => attendantBy(app.prisma, phone, pin, siteId, app.config.PIN_HMAC_SECRET),
    () => company.receipt(app.config.STATIC_URL),
  );
  const code = (params: unknown) => parseInput(couponSaleCodeSchema, params).code;
  const pinChecked = { preHandler: [authenticateDevice], config: { rateLimit: PIN_LIMIT } };

  app.get("/clients", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.clients(request)));

  app.post("/clients/:clientId/verify", pinChecked, async (request) =>
    success(await service.verifyClient(request, parseInput(clientParamsSchema, request.params).clientId)));

  app.post("/", pinChecked, async (request, reply) =>
    created(reply, await service.initiate(request)));

  app.post("/:code/confirm", pinChecked, async (request) =>
    success(await service.confirm(request, code(request.params))));

  app.post("/:code/cancel", { preHandler: [authenticateDevice] }, async (request) =>
    success(await service.cancel(request, code(request.params))));
};

export default routes;
