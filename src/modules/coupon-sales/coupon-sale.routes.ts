import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { parseInput } from "../../shared/validation/index.js";
import { ClientWalletRepository } from "../client-wallets/client-wallet.repository.js";
import { ClientWalletService } from "../client-wallets/client-wallet.service.js";
import { CouponSaleRepository } from "./coupon-sale.repository.js";
import { couponSaleClientQuerySchema, couponSaleSchema } from "./coupon-sale.schema.js";
import { CouponSaleService } from "./coupon-sale.service.js";

const routes: FastifyPluginAsync = async (app) => {
  const service = new CouponSaleService(
    new CouponSaleRepository(app.prisma),
    new ClientWalletService(new ClientWalletRepository(app.prisma))
  );
  const guard = (action: string) => ({ preHandler: [app.authenticate, app.authorize(`coupon.sales.${action}`, "coupon.sales.manage")] });

  app.get("/clients", guard("read"), async (request) =>
    success(await service.searchClients(parseInput(couponSaleClientQuerySchema, request.query), request.contextUser!)));
  app.get("/plans", guard("read"), async () => success(await service.listPlans()));
  app.post("/", guard("create"), async (request, reply) =>
    created(reply, await service.sell(parseInput(couponSaleSchema, request.body), request.contextUser!)));
};

export default routes;
