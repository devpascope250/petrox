import type { FastifyPluginAsync } from "fastify";
import { created, success } from "../../shared/http/index.js";
import { idParamsSchema, parseInput } from "../../shared/validation/index.js";
import { CouponPlanRepository } from "./coupon-plan.repository.js";
import { CouponPlanService } from "./coupon-plan.service.js";
import { createCouponPlanSchema, updateCouponPlanSchema, couponPlanQuerySchema, couponPlanStatusSchema } from "./coupon-plan.schema.js";

const routes: FastifyPluginAsync = async app => {
  const service = new CouponPlanService(new CouponPlanRepository(app.prisma));
  const guard = (action: string) => ({ preHandler: [app.authenticate, app.authorize(`coupon.plans.${action}`, "coupon.plans.manage")] });
  app.get("/", guard("read"), async request =>
    success(await service.list(parseInput(couponPlanQuerySchema, request.query))));
  app.get("/:id", guard("read"), async request =>
    success(await service.find(parseInput(idParamsSchema, request.params).id)));
  app.post("/", guard("create"), async (request, reply) =>
    created(reply, await service.create(parseInput(createCouponPlanSchema, request.body))));
  app.put("/:id", guard("edit"), async request =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(updateCouponPlanSchema, request.body))));
  app.patch("/:id/status", guard("edit"), async request =>
    success(await service.update(parseInput(idParamsSchema, request.params).id, parseInput(couponPlanStatusSchema, request.body))));
  app.delete("/:id", guard("delete"), async request =>
    success(await service.delete(parseInput(idParamsSchema, request.params).id)));
};
export default routes;
