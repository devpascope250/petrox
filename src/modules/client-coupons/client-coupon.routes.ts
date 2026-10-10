import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput, uuidSchema } from "../../shared/validation/index.js";
import { z } from "zod";
import { ClientCouponRepository } from "./client-coupon.repository.js";
import { ClientCouponService } from "./client-coupon.service.js";
import { createClientCouponSchema, updateClientCouponSchema, clientCouponQuerySchema, clientCouponStatusSchema, clientCouponClientQuerySchema } from "./client-coupon.schema.js";

const routes: FastifyPluginAsync = async app => {
  const service = new ClientCouponService(new ClientCouponRepository(app.prisma));
  const guard = (action: string) => ({ preHandler: [app.authenticate, app.authorize(`client.coupons.${action}`, "client.coupons.manage")] });
  app.get("/", guard("read"), async request =>
    success(await service.list(parseInput(clientCouponQuerySchema, request.query))));
  // Declared before "/:id", which would otherwise read "clients" as an id.
  app.get("/clients", guard("read"), async request =>
    success(await service.listByClient(parseInput(clientCouponClientQuerySchema, request.query))));
  app.get("/clients/:clientId/summary", guard("read"), async request =>
    success(await service.clientSummary(parseInput(z.object({ clientId: uuidSchema }), request.params).clientId)));
  app.get("/:id", guard("read"), async request =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", guard("create"), async (request, reply) =>
    created(reply, await service.create(parseInput(createClientCouponSchema, request.body))));
  app.put("/:id", guard("edit"), async request =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateClientCouponSchema, request.body))));
  app.patch("/:id/status", guard("edit"), async request =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(clientCouponStatusSchema, request.body))));
  app.delete("/:id", guard("delete"), async request =>
    success(await service.delete(parseInput(idParamsSchema, request.params).id)));
};
export default routes;
