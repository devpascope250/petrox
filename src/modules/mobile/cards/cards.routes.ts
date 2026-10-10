import type { FastifyPluginAsync } from "fastify";
import { success } from "../../../shared/http/index.js";
import { parseInput } from "../../../shared/validation/index.js";
import { MobileCardsRepository } from "./cards.repository.js";
import { deviceAuthenticator } from "../auth/device-auth.js";
import { cardParamsSchema, verifyCardPinSchema } from "./cards.schema.js";
import { MobileCardsService } from "./cards.service.js";

const routes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("device", null);
  const authenticateDevice = deviceAuthenticator(app, app.prisma);
  const service = new MobileCardsService(new MobileCardsRepository(app.prisma), app.config.PIN_HMAC_SECRET);

  // Registered before "/:id" so "verify-pin" is never read as a serial number.
  // Few tries a minute: a PIN is short enough to guess.
  app.post("/verify-pin", { preHandler: [authenticateDevice], config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) =>
    success(await service.verifyPin(parseInput(verifyCardPinSchema, request.body))));

  app.get("/:id", { preHandler: [authenticateDevice] }, async (request) => {
    console.log(request.params);
    return success(await service.findCard(parseInput(cardParamsSchema, request.params).id));  
  });
}

export default routes;
