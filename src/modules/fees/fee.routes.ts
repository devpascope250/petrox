import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { FeeRepository } from "./fee.repository.js";
import {
  assignFeesSchema,
  createFeeTypeSchema,
  feeTypeListQuerySchema,
  pfiParamsSchema,
  stockParamsSchema,
} from "./fee.schema.js";
import { FeeService } from "./fee.service.js";

/**
 * Fees, and what they are charged against.
 *
 * The catalogue is read and written under `fees.*`; charging them against a
 * stock receipt or a proforma is gated on the record's own module, since
 * whoever may record the stock is who decides what it cost to land.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new FeeService(new FeeRepository(app.prisma));
  const read = { preHandler: [app.authenticate, app.authorize("fee.types.read", "fee.types.manage")] };

  app.get("/types", read, async (request) =>
    success(await service.listTypes(parseInput(feeTypeListQuerySchema, request.query))));

  /** Every fee that may still be charged, for a form's picker. */
  app.get("/types/active", read, async () => success(await service.activeTypes()));

  app.get("/types/:id", read, async (request) =>
    success(await service.findType(parseInput(idParamsSchema, request.params).id)));

  app.post("/types", { preHandler: [app.authenticate, app.authorize("fee.types.create", "fee.types.manage")] },
    async (request, reply) =>
      created(reply, await service.createType(parseInput(createFeeTypeSchema, request.body))));

  app.put("/types/:id", { preHandler: [app.authenticate, app.authorize("fee.types.edit", "fee.types.manage")] },
    async (request) =>
      success(await service.updateType(
        parseInput(idParamsSchema, request.params).id,
        parseInput(createFeeTypeSchema, request.body),
      )));

  app.patch("/types/:id/status", { preHandler: [app.authenticate, app.authorize("fee.types.edit", "fee.types.manage")] },
    async (request) =>
      success(await service.changeTypeStatus(parseInput(idParamsSchema, request.params).id)));

  /* ---- charged against a stock receipt --------------------------------- */

  app.get("/stock/:stockId", { preHandler: [app.authenticate, app.authorize("stock.read", "stock.manage")] },
    async (request) =>
      success(await service.forStock(parseInput(stockParamsSchema, request.params).stockId)));

  /** The whole set: what is sent is what is charged afterwards. */
  app.put("/stock/:stockId", { preHandler: [app.authenticate, app.authorize("stock.edit", "stock.manage")] },
    async (request) =>
      success(await service.assignToStock(
        parseInput(stockParamsSchema, request.params).stockId,
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
