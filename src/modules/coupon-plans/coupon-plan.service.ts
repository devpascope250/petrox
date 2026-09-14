import { NotFoundError, ConflictError } from "../../utils/errors.js";
import { CouponPlanRepository } from "./coupon-plan.repository.js";
import type { CreateCouponPlanInput, UpdateCouponPlanInput, CouponPlanQuery } from "./coupon-plan.schema.js";

export class CouponPlanService {
  constructor(private repo: CouponPlanRepository) {}
  list(query: CouponPlanQuery) { return this.repo.list(query); }
  async find(id: string) {
    const record = await this.repo.find(id);
    if (!record) throw new NotFoundError("Coupon plan");
    return record;
  }
  async create(input: CreateCouponPlanInput) {
    
    return this.repo.create(input);
  }
  async update(id: string, input: UpdateCouponPlanInput) {
    await this.find(id);
    
    return this.repo.update(id, input);
  }
  async delete(id: string) {
    await this.find(id);
    if (await this.repo.countCoupons(id)) throw new ConflictError("RELATION_CONFLICT", "Cannot delete a plan with client coupons");
    await this.repo.delete(id);
    return { id };
  }
}
