import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { randomBytes } from "node:crypto";
import { generateCouponCode } from "../../utils/randomCodegen.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  CreateClientWalletInput,
  TransferWalletToCardInput,
  WalletCardTransferInput,
  BuyWalletCouponsInput,
  CreateWalletMovementInput,
  UpdateClientWalletInput,
  WalletMovementQuery
} from "./client-wallet.schema.js";
import { walletMovementDirection } from "./client-wallet.schema.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";

const clientWalletSelect = {
  id: true,
  amount: true,
  clientId: true,
  client: {
    select: {
      id: true,
      clientCode: true,
      name: true
    }
  },
  createdAtBy: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true
    }
  },
  status: true,
  createdAt: true,
  updatedAt: true
} as const;

const walletTransactionSelect = {
  id: true,
  clientWalletId: true,
  accountId: true,
  account: { select: { id: true, code: true, name: true } },
  referenceId: true,
  supportingDocUrl: true,
  type: true,
  direction: true,
  amount: true,
  createdAt: true
} as const;

export class ClientWalletRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery, clientId?: string) {
    const where = {
      ...(clientId ? { clientId } : {})
    };
    return this.db.$transaction([
      this.db.clientWallet.findMany({
        ...paginationArgs(query),
        where,
        orderBy: { createdAt: "desc" },
        select: clientWalletSelect
      }),
      this.db.clientWallet.count({ where })
    ]);
  }

  find(id: string, clientId?: string) {
    return this.db.clientWallet.findFirst({
      where: { id, ...(clientId ? { clientId } : {}) },
      select: clientWalletSelect
    });
  }

  findClient(clientId: string) {
    return this.db.client.findUnique({
      where: { id: clientId },
      select: { id: true }
    });
  }

  create(input: CreateClientWalletInput, createdAtBy: string) {
    return this.db.clientWallet.create({
      data: {
        clientId: input.clientId,
        createdAtBy,
        amount: new Prisma.Decimal(0)
      },
      select: clientWalletSelect
    });
  }

  update(id: string, input: UpdateClientWalletInput, clientId?: string) {
    return this.db.clientWallet.update({
      where: { id, ...(clientId ? { clientId } : {}) },
      data: input,
      select: clientWalletSelect
    });
  }

  changeStatus(id: string, status: "active" | "inactive", clientId?: string) {
    return this.db.clientWallet.update({
      where: { id, ...(clientId ? { clientId } : {}) },
      data: { status },
      select: clientWalletSelect
    });
  }

  listMovements(walletId: string, query: WalletMovementQuery) {
    const where = {
      clientWalletId: walletId,
      ...(query.startDate || query.endDate
        ? { createdAt: { ...(query.startDate ? { gte: query.startDate } : {}), ...(query.endDate ? { lte: query.endDate } : {}) } }
        : {})
    };
    return this.db.$transaction([
      this.db.walletTransaction.findMany({
        ...paginationArgs(query),
        where,
        orderBy: { createdAt: "desc" },
        select: walletTransactionSelect
      }),
      this.db.walletTransaction.count({ where })
    ]);
  }

  createMovement(walletId: string, input: CreateWalletMovementInput, clientId?: string) {
    if (walletMovementDirection[input.type] === "OUT") {
      throw new BusinessError("WALLET_OPERATION_REQUIRED", "Use coupon purchase or card transfer to debit a wallet");
    }
    return this.db.$transaction(async (tx) => {
      if (input.accountId) {
        const account = await tx.companyAccount.findFirst({
          where: { id: input.accountId, status: "active" },
          select: { id: true }
        });
        if (!account) throw new NotFoundError("Active company account");
      }

      const amount = new Prisma.Decimal(input.amount);
      const direction = walletMovementDirection[input.type];
      const updated = await tx.clientWallet.updateMany({
        where: {
          id: walletId,
          status: "active",
          ...(clientId ? { clientId } : {}),
          ...(direction === "OUT" ? { amount: { gte: amount } } : {})
        },
        data: {
          amount: direction === "IN"
            ? { increment: amount }
            : { decrement: amount }
        }
      });

      if (updated.count !== 1) {
        throw new BusinessError(
          "WALLET_MOVEMENT_FAILED",
          direction === "OUT"
            ? "Wallet balance is insufficient for this movement"
            : "Wallet is inactive or unavailable"
        );
      }

      const transaction = await tx.walletTransaction.create({
        data: {
          clientWalletId: walletId,
          accountId: input.accountId,
          referenceId: input.referenceId,
          supportingDocUrl: input.supportingDocUrl,
          type: input.type,
          direction,
          amount
        },
        select: walletTransactionSelect
      });
      const wallet = await tx.clientWallet.findUniqueOrThrow({
        where: { id: walletId },
        select: clientWalletSelect
      });

      return { transaction, wallet };
    });
  }

  private async activeWallet(tx: Prisma.TransactionClient, id: string, clientId?: string) {
    const wallet = await tx.clientWallet.findFirst({
      where: { id, ...(clientId ? { clientId } : {}) },
      select: clientWalletSelect
    });
    if (!wallet) throw new NotFoundError("Client wallet");
    if (wallet.status !== "active") {
      throw new BusinessError("WALLET_INACTIVE", "Wallet is inactive");
    }
    return wallet;
  }

  private async debitWallet(tx: Prisma.TransactionClient, id: string, clientId: string, amount: Prisma.Decimal) {
    if (!amount.isPositive() || amount.greaterThan("9999999999999999.99")) {
      throw new BusinessError("INVALID_AMOUNT", "Amount is outside the supported monetary range");
    }
    const updated = await tx.clientWallet.updateMany({
      where: { id, clientId, status: "active", amount: { gte: amount } },
      data: { amount: { decrement: amount } }
    });
    if (updated.count !== 1) {
      throw new BusinessError("WALLET_MOVEMENT_FAILED", "Wallet is inactive or has insufficient balance");
    }
  }

  /**
   * The cards a client holds as main cards — copies are left out — with their
   * balances. A card is a main card of every active assignment built on it.
   */
  async listMainCards(clientId: string) {
    const assignments = await this.db.cardCopy.findMany({
      where: { clientId, status: true },
      distinct: ["cardId"],
      orderBy: { cardId: "asc" },
      select: {
        card: { select: { id: true, cardNumber: true, serialNumber: true, balance: true, state: true,
          cardType: { select: { id: true, name: true } } } }
      }
    });
    return assignments.map(({ card }) => ({ ...card, id: card.id.toString(), balance: card.balance.toFixed(2) }));
  }

  /**
   * Moves money between a wallet and one of its client's main cards, in the
   * direction asked. Both sides are recorded — a wallet transaction and a card
   * transaction — and either both balances change or neither does.
   */
  cardTransfer(walletId: string, input: WalletCardTransferInput, createdById: string, clientId?: string) {
    return this.db.$transaction(async tx => {
      const wallet = await this.activeWallet(tx, walletId, clientId);
      // The main card's own assignment when it has one, else any active one on it.
      const assignment = await tx.cardCopy.findFirst({
        where: { clientId: wallet.clientId, status: true, cardId: input.cardId },
        orderBy: [{ cardCopyId: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        select: { id: true }
      });
      if (!assignment) throw new NotFoundError("Main card assigned to this client");

      const amount = new Prisma.Decimal(input.amount);
      const toCard = input.direction === "TO_CARD";
      if (toCard) {
        await this.debitWallet(tx, walletId, wallet.clientId, amount);
        const credited = await tx.card.updateMany({
          where: {
            id: input.cardId,
            state: 1,
            balance: { lte: new Prisma.Decimal("9999999999999999.99").minus(amount) }
          },
          data: { balance: { increment: amount } }
        });
        if (credited.count !== 1) {
          throw new BusinessError("CARD_TRANSFER_FAILED", "Card is inactive, unavailable, or its balance limit would be exceeded");
        }
      } else {
        const debited = await tx.card.updateMany({
          where: { id: input.cardId, state: 1, balance: { gte: amount } },
          data: { balance: { decrement: amount } }
        });
        if (debited.count !== 1) {
          throw new BusinessError("CARD_TRANSFER_FAILED", "Card is inactive or its balance is insufficient");
        }
        const credited = await tx.clientWallet.updateMany({
          where: {
            id: walletId,
            status: "active",
            amount: { lte: new Prisma.Decimal("9999999999999999.99").minus(amount) }
          },
          data: { amount: { increment: amount } }
        });
        if (credited.count !== 1) {
          throw new BusinessError("WALLET_MOVEMENT_FAILED", "Wallet is inactive or its balance limit would be exceeded");
        }
      }

      const cardTransaction = await tx.cardCopyTransaction.create({
        data: {
          carfdCopyId: assignment.id, type: "TRANSFER", direction: toCard ? "IN" : "OUT", amount, createdById
        }
      });
      const transaction = await tx.walletTransaction.create({
        data: {
          clientWalletId: walletId, type: "TRANSFER", direction: toCard ? "OUT" : "IN", amount,
          referenceId: cardTransaction.id.toString()
        },
        select: walletTransactionSelect
      });
      const card = await tx.card.findUniqueOrThrow({
        where: { id: input.cardId }, select: { id: true, cardNumber: true, balance: true }
      });
      return {
        wallet: await tx.clientWallet.findUniqueOrThrow({ where: { id: walletId }, select: clientWalletSelect }),
        transaction,
        card: { ...card, id: card.id.toString() },
        cardTransaction: {
          ...cardTransaction, id: cardTransaction.id.toString(), carfdCopyId: cardTransaction.carfdCopyId.toString()
        }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  transferToCard(walletId: string, input: TransferWalletToCardInput, createdById: string, clientId?: string) {
    return this.db.$transaction(async tx => {
      const wallet = await this.activeWallet(tx, walletId, clientId);
      const assignment = await tx.cardCopy.findFirst({
        where: {
          clientId: wallet.clientId,
          status: true,
          OR: [{ cardId: input.cardId }, { cardCopyId: input.cardId }]
        },
        select: { id: true }
      });
      if (!assignment) throw new NotFoundError("Active card assignment for this client");

      const amount = new Prisma.Decimal(input.amount);
      await this.debitWallet(tx, walletId, wallet.clientId, amount);
      const credited = await tx.card.updateMany({
        where: {
          id: input.cardId,
          state: 1,
          balance: { lte: new Prisma.Decimal("9999999999999999.99").minus(amount) }
        },
        data: { balance: { increment: amount } }
      });
      if (credited.count !== 1) {
        throw new BusinessError("CARD_TRANSFER_FAILED", "Card is inactive, unavailable, or its balance limit would be exceeded");
      }
      const cardTransaction = await tx.cardCopyTransaction.create({
        data: { carfdCopyId: assignment.id, type: "TRANSFER", direction: "IN", amount, createdById }
      });
      const transaction = await tx.walletTransaction.create({
        data: {
          clientWalletId: walletId, type: "TRANSFER", direction: "OUT", amount,
          referenceId: cardTransaction.id.toString()
        },
        select: walletTransactionSelect
      });
      const card = await tx.card.findUniqueOrThrow({
        where: { id: input.cardId }, select: { id: true, balance: true }
      });
      return {
        wallet: await tx.clientWallet.findUniqueOrThrow({ where: { id: walletId }, select: clientWalletSelect }),
        transaction,
        card: { ...card, id: card.id.toString() },
        cardTransaction: {
          ...cardTransaction, id: cardTransaction.id.toString(), carfdCopyId: cardTransaction.carfdCopyId.toString()
        }
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Sells coupons from one or more plans, paid from the wallet in one debit.
   *
   * Refused as a whole when a plan is inactive, when a line asks for more
   * coupons than its plan has left — a plan issues at most `number` coupons —
   * or when the total exceeds the wallet balance.
   */
  buyCoupons(walletId: string, input: BuyWalletCouponsInput, clientId?: string) {
    return this.db.$transaction(async tx => {
      const wallet = await this.activeWallet(tx, walletId, clientId);
      const planIds = input.items.map((item) => item.couponPlanId);
      const plans = await tx.couponPlan.findMany({
        where: { id: { in: planIds }, status: "active" },
        select: { id: true, name: true, number: true, amount: true, _count: { select: { clientCoupons: true } } }
      });
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      let amount = new Prisma.Decimal(0);
      for (const item of input.items) {
        const plan = planById.get(item.couponPlanId);
        if (!plan) throw new NotFoundError("Active coupon plan");
        const remaining = Math.max(plan.number - plan._count.clientCoupons, 0);
        if (item.quantity > remaining) {
          throw new BusinessError(
            "COUPON_PLAN_EXHAUSTED",
            `${plan.name} has ${remaining} coupon${remaining === 1 ? "" : "s"} left; ${item.quantity} requested`,
            422,
            { couponPlanId: plan.id, remaining, requested: item.quantity }
          );
        }
        amount = amount.add(plan.amount.mul(item.quantity));
      }
      await this.debitWallet(tx, walletId, wallet.clientId, amount);
      const coupons = [];
      const transactions = [];
      for (const item of input.items) {
        const plan = planById.get(item.couponPlanId)!;
        for (let index = 0; index < item.quantity; index++) {
          const coupon = await tx.clientCoupon.create({
            data: {
              couponPlanId: plan.id, clientId: wallet.clientId, amount: plan.amount,
              code: generateCouponCode(), token: randomBytes(32).toString("hex"), status: "available"
            }
          });
          coupons.push(coupon);
          transactions.push(await tx.walletTransaction.create({
            data: {
              clientWalletId: walletId, type: "PAYMENT", direction: "OUT",
              amount: plan.amount, referenceId: coupon.id
            },
            select: walletTransactionSelect
          }));
        }
      }
      return {
        wallet: await tx.clientWallet.findUniqueOrThrow({ where: { id: walletId }, select: clientWalletSelect }),
        amount, coupons, transactions
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
