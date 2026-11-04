import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError, forbidden } from "../../utils/errors.js";
import { CreateStockClearanceSchema } from "./clearance.schema.js";
import type { ClearanceDecisionSchema } from "./authorizers/clearance-authorizer.schema.js";

const requestSelect = {
  id: true, quantity: true, fees: true, amount: true, clearanceStatus: true,
  dmsDocUrl: true, assessmentDocUrl: true, supportingDocUrl: true,
  paymentDocUrl: true, paidAt: true, createdAt: true, updatedAt: true,
  item: { select: { id: true, name: true } },
  agent: { select: { id: true, names: true, fees: true, status: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
  payer: { select: { id: true, firstName: true, lastName: true } },
  taxes: {
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, amount: true, taxId: true, createdAt: true },
  },
  approvals: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true, status: true, reason: true, createdAt: true, updatedAt: true,
      authorizer: {
        select: {
          id: true, position: true, level: true, status: true,
          authoriser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  },
  clearances: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true, quantity: true, status: true,
      centralStock: { select: { id: true, receiptNumber: true, createdAt: true } },
    },
  },
} as const;

export class StockClearanceRepository {
  constructor(private db: PrismaClient) {}

  async list() {
    return await this.db.stockClearance.
    findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quantity: true,
        centralStock: { 
          select: { 
            id: true, 
            itemId: true, 
            ambQuantity: true, 
            quantityAt20C: true,
            gainQty: true,
            lossQty: true,
            toleranceRate: true,
            createdAt: true 
          }, 
        },
        agentId: true,
        agent: true,
        status: true,
        amount: true,
        fees: true,
        clearedBy: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        createdAt: true,
        requestId: true,
        request: { select: { id: true, clearanceStatus: true, paymentDocUrl: true, paidAt: true } },
      },
    });
  }

  /** Every act of clearing, newest first, with its taxes, decisions and rows. */
  requests() {
    return this.db.clearanceRequest.findMany({ orderBy: { createdAt: "desc" }, select: requestSelect });
  }

  /**
   * One act of clearing.
   *
   * `asUserId` is given when the caller holds no clearance permission: then
   * they may only see it by being an authorizer, which is how the emailed link
   * works. Without that it would be readable by anybody signed in.
   */
  async findRequest(id: string, asUserId?: string) {
    if (asUserId !== undefined) {
      const member = await this.db.clearanceAuthorizerMember.findUnique({
        where: { authorizerId: asUserId }, select: { status: true },
      });
      if (!member) throw forbidden("You are not a clearance authorizer");
    }
    return this.db.clearanceRequest.findUnique({ where: { id }, select: requestSelect });
  }

  /**
   * What is waiting on this person.
   *
   * Only for somebody who is an active clearance authorizer; for anyone else
   * the list is empty rather than an error, because the page is reachable from
   * an emailed link and a stale link should not look broken.
   */
  async pendingFor(userId: string) {
    const member = await this.db.clearanceAuthorizerMember.findUnique({
      where: { authorizerId: userId },
      select: { id: true, status: true, position: true, level: true },
    });
    if (!member || member.status !== "active") return { authorizer: null, requests: [] };
    const requests = await this.db.clearanceRequest.findMany({
      where: {
        paymentDocUrl: null,
        OR: [
          { approvals: { none: { authorizerId: member.id } } },
          { approvals: { some: { authorizerId: member.id, status: { not: "approved" } } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: requestSelect,
    });
    return { authorizer: member, requests };
  }

  async create(data: CreateStockClearanceSchema) {
    return this.db.$transaction(async (tx) => {
      if (data.agentId) {
        const agent = await tx.clearingAgent.findUnique({ where: { id: data.agentId } });
        if (!agent) throw new NotFoundError("Clearing agent not found");
        if (agent.status !== "active") throw new BusinessError("400", "Clearing agent is inactive");
      }
      if (!data.clearedBy) throw new BusinessError("400", "The user raising the clearance is unknown");

      /*
       * Refused loudly here rather than leaving the clearance stuck at the
       * payment step: with nobody set up to approve, nothing can ever be
       * approved, and that is a setting to fix, not a clearance to raise.
       */
      const authorizerCount = await tx.clearanceAuthorizerMember.count({ where: { status: "active" } });
      if (authorizerCount === 0) {
        throw new BusinessError("400", "No active clearance authorizer is configured; add one under Clearance → Authorizers first");
      }

      /*
       * The taxes are read from the catalogue and their codes copied onto the
       * charge. Retiring or renaming a tax later must not rewrite what a
       * clearance was assessed under, and the total is their sum — never a
       * figure typed over them.
       */
      const taxLines: Array<{ taxId: string; code: string; amount: number }> = [];
      for (const line of data.taxes) {
        const tax = await tx.taxDescription.findUnique({ where: { id: line.taxId } });
        if (!tax) throw new NotFoundError("Tax not found");
        if (tax.status !== "active") throw new BusinessError("400", `The tax ${tax.code} is inactive`);
        taxLines.push({ taxId: tax.id, code: tax.code, amount: line.amount });
      }
      const amount = taxLines.reduce((total, line) => total + line.amount, 0);

      const stockSelect = {
        id: true, itemId: true, status: true,  ambQuantity: true, quantityAt20C: true,
        transactions: { select: { quantity: true, type: true } },
        stockClearances: { select: { quantity: true, status: true,
          centralStockOrders: { select: { quantity: true } } } },
      } as const;

      let stocks;
      if (data.type === "manual") {
        const stock = await tx.centralStock.findUnique({
          where: { id: data.centralStockId! },
          select: stockSelect,
        });
        if (!stock) throw new NotFoundError("Central stock not found");
        if (stock.itemId !== data.itemId) {
          throw new BusinessError("400", "Central stock does not belong to the selected item");
        }
        if (stock.status !== "inStock") {
          throw new BusinessError("400", "Central stock is not in stock");
        }
        stocks = [stock];
      } else {
        stocks = await tx.centralStock.findMany({
          where: { itemId: data.itemId, status: "inStock" },
          orderBy: { createdAt: "asc" },
          select: stockSelect,
        });
      }

      let requested = data.quantity;
      const allocations: Array<{ centralStockId: string; quantity: number }> = [];
      for (const stock of stocks) {
        if (requested <= 0) break;
        const allocated = stock.stockClearances.reduce((sum, row) => sum + Number(row.quantity), 0);
        const physicalRemaining = stock.transactions.reduce((balance, transaction) => {
          const quantity = Number(transaction.quantity);
          return transaction.type === "received" || transaction.type === "reconcilliationIn"
            ? balance + quantity : balance - quantity;
        }, 0);
        const clearedRemaining = stock.stockClearances
          .filter((row) => row.status === "cleared")
          .reduce((balance, row) => balance + Number(row.quantity)
            - row.centralStockOrders.reduce((sold, order) => sold + Number(order.quantity), 0), 0);
        const legalUncleared = Number(stock.quantityAt20C) - allocated;
        const physicalUncleared = physicalRemaining - Math.max(0, clearedRemaining);
        const available = Math.max(0, Math.min(legalUncleared, physicalUncleared));
        const quantity = Math.min(available, requested);
        if (quantity > 0) allocations.push({ centralStockId: stock.id, quantity });
        requested -= quantity;
      }
      if (requested > 0) {
        throw new BusinessError("400", `Only ${data.quantity - requested} uncleared stock is available`);
      }

      /*
       * One act of clearing, however many receipts it draws on. The rows below
       * hold the litres — they count against what is still available to clear,
       * so nobody else can claim them — but they stay **uncleared**: the stock
       * only moves once every authorizer has approved and the payment has been
       * confirmed.
       */
      const request = await tx.clearanceRequest.create({
        data: {
          itemId: data.itemId,
          quantity: data.quantity,
          fees: data.fees,
          amount,
          agentId: data.agentId,
          dmsDocUrl: data.dmsDocUrl,
          assessmentDocUrl: data.assessmentDocUrl,
          supportingDocUrl: data.supportingDocUrl,
          createdBy: data.clearedBy,
          taxes: { create: taxLines.map((line) => ({
            taxId: line.taxId, code: line.code, amount: line.amount,
            recordedBy: data.clearedBy!,
          })) },
        },
      });

      for (const allocation of allocations) {
        const ratio = allocation.quantity / data.quantity;
        await tx.stockClearance.create({ data: {
          ...allocation, status: "uncleared", requestId: request.id,
          fees: data.fees === undefined ? undefined : data.fees * ratio,
          amount: amount * ratio,
          agentId: data.agentId, clearedBy: data.clearedBy,
          dmsDocUrl: data.dmsDocUrl,
          assessmentDocUrl: data.assessmentDocUrl,
          supportingDocUrl: data.supportingDocUrl,
        }});
      }

      return (await tx.clearanceRequest.findUnique({ where: { id: request.id }, select: requestSelect }))!;
    }, { isolationLevel: "Serializable" });
  }

  /**
   * How one authorizer goes on one clearance, written in place: somebody who
   * rejected may come back and approve, and their answer replaces the first
   * rather than sitting beside it.
   */
  decide(requestId: string, userId: string, input: ClearanceDecisionSchema) {
    return this.db.$transaction(async (tx) => {
      const member = await tx.clearanceAuthorizerMember.findUnique({
        where: { authorizerId: userId }, select: { id: true, status: true },
      });
      if (!member) throw forbidden("You are not a clearance authorizer");
      if (member.status !== "active") throw forbidden("You are no longer an active clearance authorizer");

      const request = await tx.clearanceRequest.findUnique({
        where: { id: requestId }, select: { id: true, paymentDocUrl: true },
      });
      if (!request) throw new NotFoundError("Clearance not found");
      if (request.paymentDocUrl) {
        throw new BusinessError("400", "This clearance has already been paid and cannot be decided again");
      }

      await tx.clearanceAuthorizer.upsert({
        where: { requestId_authorizerId: { requestId, authorizerId: member.id } },
        create: { requestId, authorizerId: member.id, status: input.decision, reason: input.reason ?? null },
        // A reason already given is kept when the decision turns into an
        // approval: the question that was raised is part of the record.
        update: { status: input.decision, ...(input.reason ? { reason: input.reason } : {}) },
      });

      await this.settle(tx, requestId);
      return (await tx.clearanceRequest.findUnique({ where: { id: requestId }, select: requestSelect }))!;
    }, { isolationLevel: "Serializable" });
  }

  /**
   * Confirming the payment is what finally clears the stock: the rows this
   * request holds turn from held to cleared, and only here.
   */
  confirmPayment(requestId: string, userId: string, paymentDocUrl: string) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.clearanceRequest.findUnique({
        where: { id: requestId },
        select: { id: true, clearanceStatus: true, paymentDocUrl: true },
      });
      if (!request) throw new NotFoundError("Clearance not found");
      if (request.paymentDocUrl) throw new BusinessError("400", "This clearance has already been paid");
      // Re-settled first: an authorizer may have been added or deactivated
      // since the last decision, which changes what "all of them" means.
      const status = await this.settle(tx, requestId);
      if (status !== "approved") {
        throw new BusinessError("400", "Every active authorizer must approve before the payment can be confirmed");
      }

      await tx.clearanceRequest.update({
        where: { id: requestId },
        data: { paymentDocUrl, paidAt: new Date(), paidBy: userId },
      });
      await tx.stockClearance.updateMany({
        where: { requestId }, data: { status: "cleared" },
      });
      return (await tx.clearanceRequest.findUnique({ where: { id: requestId }, select: requestSelect }))!;
    }, { isolationLevel: "Serializable" });
  }

  /**
   * Letting go of a clearance that should not have been raised.
   *
   * Nothing else releases the litres it holds: as long as the request exists
   * they count against what is available to clear, which is the point of
   * raising it. Once it is paid it is history and cannot be removed.
   */
  async cancel(requestId: string) {
    const request = await this.db.clearanceRequest.findUnique({
      where: { id: requestId }, select: { paymentDocUrl: true, clearances: { select: {
        id: true, centralStockOrders: { select: { id: true } } } } },
    });
    if (!request) throw new NotFoundError("Clearance not found");
    if (request.paymentDocUrl) throw new BusinessError("400", "A paid clearance cannot be cancelled");
    if (request.clearances.some((row) => row.centralStockOrders.length > 0)) {
      throw new BusinessError("400", "Stock has already been sold against this clearance");
    }
    return this.db.$transaction(async (tx) => {
      await tx.stockClearance.deleteMany({ where: { requestId } });
      // The taxes and the decisions go with it: the foreign keys cascade.
      return tx.clearanceRequest.delete({ where: { id: requestId } });
    });
  }

  find(id: string) {
    return this.db.stockClearance.findUnique({ where: { id } });
  }

  /**
   * Works out where a clearance stands from the decisions on it.
   *
   * Rejected the moment one active authorizer says no; approved only when
   * every active authorizer has approved; awaiting until then. Read from the
   * authorizers who are active **now**, so adding one puts an approved
   * clearance back in the queue rather than letting it through on a list that
   * no longer holds.
   */
  private async settle(
    tx: Pick<PrismaClient, "clearanceAuthorizerMember" | "clearanceAuthorizer" | "clearanceRequest">,
    requestId: string,
  ) {
    const active = await tx.clearanceAuthorizerMember.findMany({
      where: { status: "active" }, select: { id: true },
    });
    const decisions = await tx.clearanceAuthorizer.findMany({
      where: { requestId }, select: { authorizerId: true, status: true },
    });
    const byAuthorizer = new Map(decisions.map((decision) => [decision.authorizerId, decision.status]));
    const rejected = active.some((member) => byAuthorizer.get(member.id) === "rejected");
    const allApproved = active.length > 0
      && active.every((member) => byAuthorizer.get(member.id) === "approved");
    const status = rejected ? "rejected" : allApproved ? "approved" : "awaiting";
    await tx.clearanceRequest.update({ where: { id: requestId }, data: { clearanceStatus: status } });
    return status;
  }
}
