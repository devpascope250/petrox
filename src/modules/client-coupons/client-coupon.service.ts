import { randomBytes } from "node:crypto";
import { generateCouponCode } from "../../utils/randomCodegen.js";
import { NotFoundError } from "../../utils/errors.js";
import { ClientCouponRepository } from "./client-coupon.repository.js";
import type { CreateClientCouponInput, UpdateClientCouponInput, ClientCouponQuery, ClientCouponClientQuery } from "./client-coupon.schema.js";

export class ClientCouponService {
  constructor(private repo: ClientCouponRepository) {}
  list(query: ClientCouponQuery) { return this.repo.list(query); }
  listByClient(query: ClientCouponClientQuery) { return this.repo.listByClient(query); }
  async clientSummary(clientId: string) {
    if (!(await this.repo.findClient(clientId))) throw new NotFoundError("Client");
    return this.repo.clientSummary(clientId);
  }
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
    return this.repo.create({ ...input, amount: String(couponPlan.amount ?? input.amount), code: input.code ?? generateCouponCode(), token: input.token ?? randomBytes(32).toString("hex") });
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
