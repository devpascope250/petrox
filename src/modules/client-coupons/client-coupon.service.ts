import { randomBytes, randomUUID } from "node:crypto";
import { NotFoundError } from "../../utils/errors.js";
import { ClientCouponRepository } from "./client-coupon.repository.js";
import type { CreateClientCouponInput, UpdateClientCouponInput, ClientCouponQuery } from "./client-coupon.schema.js";

export class ClientCouponService {
  constructor(private repo: ClientCouponRepository) {}
  list(query: ClientCouponQuery) { return this.repo.list(query); }
  async find(id: string) {
    const record = await this.repo.find(id);
    if (!record) throw new NotFoundError("Client coupon");
    return record;
  }
  async create(input: CreateClientCouponInput) {
    if (input.clientId && !(await this.repo.findClient(input.clientId))) throw new NotFoundError("Client");
    const couponPlan = await this.repo.findPlan(input.couponPlanId);
    if (!couponPlan) throw new NotFoundError("Coupon plan");
    if (input.couponPlanId && !couponPlan) throw new NotFoundError("Coupon plan");
    return this.repo.create({ ...input, amount: String(couponPlan.amount), code: input.code ?? randomUUID(), token: input.token ?? randomBytes(32).toString("hex") });
  }
  async update(id: string, input: UpdateClientCouponInput) {
    await this.find(id);
    if (input.clientId && !(await this.repo.findClient(input.clientId))) throw new NotFoundError("Client");
    if (input.couponPlanId && !(await this.repo.findPlan(input.couponPlanId))) throw new NotFoundError("Coupon plan");
    return this.repo.update(id, input);
  }
  async delete(id: string) {
    await this.find(id);
    
    await this.repo.delete(id);
    return { id };
  }
}
