import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { FeeRepository } from "./fee.repository.js";
import {
  assignFeesSchema,
  createFeeTypeSchema,
  feeTypeListQuerySchema,
  centralStockParamsSchema,
  pfiParamsSchema,
} from "./fee.schema.js";
import { FeeService } from "./fee.service.js";

/**
 * Fees, and what they are charged against.
 *
 * The catalogue is read and written under `fees.*`; charging them against a
 * central stock receipt or a proforma is gated on the record's own module,
 * since whoever receives the stock is who knows what it cost to land.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new FeeService(new FeeRepository(app.prisma));
  const read = { preHandler: [app.authenticate, app.authorize("fees.read", "fees.manage")] };

  app.get("/types", read, async (request) =>
    success(await service.listTypes(parseInput(feeTypeListQuerySchema, request.query))));

  /** Every fee that may still be charged, for a form's picker. */
  app.get("/types/active", read, async () => success(await service.activeTypes()));

  app.get("/types/:id", read, async (request) =>
    success(await service.findType(parseInput(idParamsSchema, request.params).id)));

  app.post("/types", { preHandler: [app.authenticate, app.authorize("fees.create", "fees.manage")] },
    async (request, reply) =>
      created(reply, await service.createType(parseInput(createFeeTypeSchema, request.body))));

  app.put("/types/:id", { preHandler: [app.authenticate, app.authorize("fees.edit", "fees.manage")] },
    async (request) =>
      success(await service.updateType(
        parseInput(idParamsSchema, request.params).id,
        parseInput(createFeeTypeSchema, request.body),
      )));

  app.patch("/types/:id/status", { preHandler: [app.authenticate, app.authorize("fees.edit", "fees.manage")] },
    async (request) =>
      success(await service.changeTypeStatus(parseInput(idParamsSchema, request.params).id)));

  /* ---- charged against a central stock receipt ------------------------- */

  app.get("/central-stock/:centralStockId",
    { preHandler: [app.authenticate, app.authorize("central.stock.read", "central.stock.manage")] },
    async (request) =>
      success(await service.forCentralStock(parseInput(centralStockParamsSchema, request.params).centralStockId)));

  /** The whole set: what is sent is what is charged afterwards. */
  app.put("/central-stock/:centralStockId",
    { preHandler: [app.authenticate, app.authorize("central.stock.edit", "central.stock.manage")] },
    async (request) =>
      success(await service.assignToCentralStock(
        parseInput(centralStockParamsSchema, request.params).centralStockId,
        parseInput(assignFeesSchema, request.body),
        request.contextUser?.userId ?? null,
      )));

  /* ---- charged against a proforma -------------------------------------- */

  app.get("/pfi/:pfiId", { preHandler: [app.authenticate, app.authorize("pfi.read", "pfi.manage")] },
    async (request) =>
      success(await service.forPfi(parseInput(pfiParamsSchema, request.params).pfiId)));

  app.put("/pfi/:pfiId", { preHandler: [app.authenticate, app.authorize("pfi.edit", "pfi.manage")] },
    async (request) =>
      success(await service.assignToPfi(
        parseInput(pfiParamsSchema, request.params).pfiId,
        parseInput(assignFeesSchema, request.body),
        request.contextUser?.userId ?? null,
      )));
};

export default routes;
