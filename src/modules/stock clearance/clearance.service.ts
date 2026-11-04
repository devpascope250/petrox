import type { AppConfig } from "../../config/env.js";
import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { StockClearanceRepository } from "./clearance.repository.js";
import { CreateStockClearanceSchema } from "./clearance.schema.js";
import type { ClearanceDecisionSchema } from "./authorizers/clearance-authorizer.schema.js";
import { notifyClearanceAuthorizers } from "./clearance-notify.js";

export class StockClearanceService {
  constructor(
    private repo: StockClearanceRepository,
    private config: AppConfig,
    private db?: PrismaClient,
  ) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  requests() { return this.repo.requests(); }
  findRequest(id: string, asUserId?: string) { return this.repo.findRequest(id, asUserId); }
  pendingFor(userId: string) { return this.repo.pendingFor(userId); }

  async create(input: CreateStockClearanceSchema) {
    const request = await this.repo.create(input);
    /*
     * The authorizers are told at once, with the taxes they are being asked to
     * approve. Mail failing must not undo a clearance that is already raised,
     * so it is logged and the clearance stands — the page lists it either way.
     */
    if (this.db) {
      try {
        await notifyClearanceAuthorizers(this.db, request.id);
      } catch (error) {
        console.error(`Could not email the authorizers about clearance ${request.id}:`, error);
      }
    }
    return request;
  }

  async decide(requestId: string, userId: string, input: ClearanceDecisionSchema) {
    return this.repo.decide(requestId, userId, input);
  }

  confirmPayment(requestId: string, userId: string, paymentDocUrl: string) {
    return this.repo.confirmPayment(requestId, userId, paymentDocUrl);
  }

  cancel(requestId: string) { return this.repo.cancel(requestId); }
}
