import type { FastifyPluginAsync } from "fastify";
import { success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { PosTransactionRepository } from "./pos-transaction.repository.js";
import { posTransactionListQuerySchema } from "./pos-transaction.schema.js";
import { PosTransactionService } from "./pos-transaction.service.js";

/**
 * The web's read of sales recorded by the POS devices: `/pos-transactions`
 * (the report, with totals) and `/pos-transactions/:id` (one sale in full,
 * pictures included). Guarded by the "POS Transactions" module.
 */
const routes: FastifyPluginAsync = async (app) => {
  const service = new PosTransactionService(
    new PosTransactionRepository(app.prisma, app.config.STATIC_URL ?? app.config.APP_URL),
  );
  const read = app.authorize("pos.transactions.read", "pos.transactions.manage");

  app.get("/", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.list(parseInput(posTransactionListQuerySchema, request.query), request.contextUser!)));
  app.get("/:id", { preHandler: [app.authenticate, read] }, async (request) =>
    success(await service.find(parseInput(idParamsSchema, request.params).id, request.contextUser!)));
};

export default routes;
