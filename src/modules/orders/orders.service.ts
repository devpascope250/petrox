import { PlanStatus, Prisma } from "../../../prisma/generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { generateOrderCode } from "../../utils/randomCodegen.js";
import { OrderRepository } from "./orders.repository.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { CreateOrderPlanSchema, CreateOrderSchema, OrderListQuery } from "./orders.schema.js";

export class OrderService {
  constructor(private repo: OrderRepository, private config: AppConfig) {}

  async list(query: OrderListQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

   async listByPlanOrSupplier(supplierId?: string, planId?: string) {
    return await this.repo.listByPlanOrSupplier(supplierId, planId);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateOrderSchema, userId: string) {
    const data: Prisma.OrderUncheckedCreateInput = {
      createdByUserId: userId,
      ...input,
      orderCode: generateOrderCode()
    }
    return this.repo.create(data);
  }

  async update(id: string, input: CreateOrderSchema) {
    return await this.repo.update(id, input);
  }


  listOrderPlan() {
    return this.repo.listOrderPlan();
  }

  findOrderPlan(id: string){
    return this.repo.findOrderPlan(id);
  }

  async updateOrderPlan(id: string, input: CreateOrderPlanSchema) {
    return await this.repo.updateOrderPlan(id, input)
  }

  async createOrderPlan(data: CreateOrderPlanSchema) {
    return await this.repo.createOrderPlan(data);
  }

  async updateSupplierTypeStatus (id: string, status: PlanStatus) {
    return await this.repo.changeOrderPlanStatus(id, status);
  }
}