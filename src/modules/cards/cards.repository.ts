import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  CreateCardCopyInput,
  CreateCardInput,
  UpdateCardCopyInput,
  UpdateCardInput
} from "./cards.schema.js";
import { ConflictError } from "../../utils/errors.js";

const cardSelect = {
  id: true, cardNumber: true, serialNumber: true, cardCode: true, balance: true,
  availability: true, type: true, securityCategory: true, state: true,
  swapStatus: true, inventoryStatus: true, createdAt: true, updatedAt: true
} as const;

const cardCopySelect = {
  id: true, clientId: true, cardId: true, cardCopyId: true, lastIndex: true,
  status: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, clientCode: true, name: true } },
  card: { select: cardSelect },
  copyCard: { select: cardSelect }
} as const;

const serializeCard = <T extends { id: bigint }>(card: T) => ({ ...card, id: card.id.toString() });
const serializeCopy = <T extends { id: bigint; cardId: bigint; cardCopyId: bigint | null; card: { id: bigint }; copyCard: { id: bigint } | null }>(copy: T) => ({
  ...copy,
  id: copy.id.toString(),
  cardId: copy.cardId.toString(),
  cardCopyId: copy.cardCopyId?.toString() ?? null,
  card: serializeCard(copy.card),
  copyCard: copy.copyCard ? serializeCard(copy.copyCard) : null
});

export class CardsRepository {
  constructor(private db: PrismaClient) {}

  async listCards(query: PaginationQuery, clientId?: string) {
    const where: Prisma.CardWhereInput = clientId ? {
      OR: [{ originalCards: { some: { clientId } } }, { copyCards: { some: { clientId } } }]
    } : {};
    const [items, total] = await this.db.$transaction([
      this.db.card.findMany({ ...paginationArgs(query), where, orderBy: { createdAt: "desc" }, select: cardSelect }),
      this.db.card.count({ where })
    ]);
    return [items.map(serializeCard), total] as const;
  }

  async findCard(id: bigint, clientId?: string) {
    const card = await this.db.card.findFirst({
      where: { id, ...(clientId ? { OR: [{ originalCards: { some: { clientId } } }, { copyCards: { some: { clientId } } }] } : {}) },
      select: cardSelect
    });
    return card ? serializeCard(card) : null;
  }

  async createCard(input: CreateCardInput) {
    const card = await this.db.card.create({ data: input, select: cardSelect });
    return serializeCard(card);
  }

  async updateCard(id: bigint, input: UpdateCardInput) {
    const card = await this.db.card.update({ where: { id }, data: input, select: cardSelect });
    return serializeCard(card);
  }

  async deleteCard(id: bigint) {
    const card = await this.db.card.delete({ where: { id }, select: cardSelect });
    return serializeCard(card);
  }

  async listCopies(query: PaginationQuery, clientId?: string) {
    const where = clientId ? { clientId } : {};
    const [items, total] = await this.db.$transaction([
      this.db.cardCopy.findMany({ ...paginationArgs(query), where, orderBy: { createdAt: "desc" }, select: cardCopySelect }),
      this.db.cardCopy.count({ where })
    ]);
    return [items.map(serializeCopy), total] as const;
  }

  async findCopy(id: bigint, clientId?: string) {
    const copy = await this.db.cardCopy.findFirst({ where: { id, ...(clientId ? { clientId } : {}) }, select: cardCopySelect });
    return copy ? serializeCopy(copy) : null;
  }

  findClient(id: string) { return this.db.client.findUnique({ where: { id }, select: { id: true } }); }
  findRawCard(id: bigint) { return this.db.card.findUnique({ where: { id }, select: { id: true, availability: true } }); }
  findActiveAssignment(cardId: bigint, excludedCopyId?: bigint) {
    return this.db.cardCopy.findFirst({
      where: {
        status: true,
        ...(excludedCopyId ? { id: { not: excludedCopyId } } : {}),
        OR: [{ cardId }, { cardCopyId: cardId }]
      },
      select: { id: true }
    });
  }

  async createCopy(input: CreateCardCopyInput) {
    const copy = await this.db.$transaction(async (tx) => {
      const cardIds = [input.cardId, ...(input.cardCopyId ? [input.cardCopyId] : [])];
      const reserved = await tx.card.updateMany({
        where: { id: { in: cardIds }, availability: true },
        data: { availability: false, inventoryStatus: 3 }
      });
      if (reserved.count !== cardIds.length) {
        throw new ConflictError("CARD_UNAVAILABLE", "One or more cards are unavailable");
      }
      return tx.cardCopy.create({ data: input, select: cardCopySelect });
    });
    return serializeCopy(copy);
  }

  async updateCopy(id: bigint, input: UpdateCardCopyInput) {
    const copy = await this.db.cardCopy.update({ where: { id }, data: input, select: cardCopySelect });
    return serializeCopy(copy);
  }

  async assignCopyCard(id: bigint, cardCopyId: bigint) {
    const copy = await this.db.$transaction(async (tx) => {
      const assignment = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { cardCopyId: true, status: true } });
      if (assignment.status) {
        const reserved = await tx.card.updateMany({
          where: { id: cardCopyId, availability: true },
          data: { availability: false, inventoryStatus: 3 }
        });
        if (reserved.count !== 1) throw new ConflictError("CARD_UNAVAILABLE", "Copy card is unavailable");
      }
      if (assignment.cardCopyId) {
        await tx.card.update({
          where: { id: assignment.cardCopyId },
          data: { availability: true, inventoryStatus: 1 }
        });
      }
      return tx.cardCopy.update({ where: { id }, data: { cardCopyId }, select: cardCopySelect });
    });
    return serializeCopy(copy);
  }

  async changeCopyStatus(id: bigint, status: boolean) {
    const copy = await this.db.$transaction(async (tx) => {
      const assignment = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { cardId: true, cardCopyId: true } });
      const cardIds = [assignment.cardId, ...(assignment.cardCopyId ? [assignment.cardCopyId] : [])];
      if (status) {
        const reserved = await tx.card.updateMany({
          where: { id: { in: cardIds }, availability: true },
          data: { availability: false, inventoryStatus: 3 }
        });
        if (reserved.count !== cardIds.length) throw new ConflictError("CARD_UNAVAILABLE", "One or more cards are unavailable");
      } else {
        await tx.card.updateMany({
          where: { id: { in: cardIds } },
          data: { availability: true, inventoryStatus: 1 }
        });
      }
      return tx.cardCopy.update({ where: { id }, data: { status }, select: cardCopySelect });
    });
    return serializeCopy(copy);
  }

  async deleteCopy(id: bigint) {
    const copy = await this.db.$transaction(async (tx) => {
      const assignment = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { cardId: true, cardCopyId: true, status: true } });
      const deleted = await tx.cardCopy.delete({ where: { id }, select: cardCopySelect });
      if (assignment.status) {
        await tx.card.updateMany({
          where: { id: { in: [assignment.cardId, ...(assignment.cardCopyId ? [assignment.cardCopyId] : [])] } },
          data: { availability: true, inventoryStatus: 1 }
        });
      }
      return deleted;
    });
    return serializeCopy(copy);
  }
}
