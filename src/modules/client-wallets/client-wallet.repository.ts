import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { randomBytes, randomUUID } from "node:crypto";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  CreateClientWalletInput,
  TransferWalletToCardInput,
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

  listMovements(walletId: string, query: WalletMovementQuery & { startDate: Date; endDate: Date }) {
    const where = {
      clientWalletId: walletId,
      createdAt: { gte: query.startDate, lte: query.endDate }
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

  buyCoupons(walletId: string, input: BuyWalletCouponsInput, clientId?: string) {
    return this.db.$transaction(async tx => {
      const wallet = await this.activeWallet(tx, walletId, clientId);
      const plan = await tx.couponPlan.findFirst({
        where: { id: input.couponPlanId, status: "active" },
        select: { id: true, amount: true }
      });
      if (!plan) throw new NotFoundError("Active coupon plan");
      const amount = plan.amount.mul(input.quantity);
      await this.debitWallet(tx, walletId, wallet.clientId, amount);
      const coupons = [];
      const transactions = [];
      for (let index = 0; index < input.quantity; index++) {
        const coupon = await tx.clientCoupon.create({
          data: {
            couponPlanId: plan.id, clientId: wallet.clientId, amount: plan.amount,
            code: randomUUID(), token: randomBytes(32).toString("hex"), status: "available"
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
      return {
        wallet: await tx.clientWallet.findUniqueOrThrow({ where: { id: walletId }, select: clientWalletSelect }),
        amount, coupons, transactions
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
