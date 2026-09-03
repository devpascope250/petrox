import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  CreateClientWalletInput,
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
}
