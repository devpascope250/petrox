import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  AssignCardsInput,
  CardClientQuery,
  CardCopyListQuery,
  CardListQuery,
  CardTransactionQuery,
  CreateCardCopyInput,
  CreateCardInput,
  UpdateCardCopyInput,
  UpdateCardInput
} from "./cards.schema.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { DEFAULT_CARD_PIN, hashCardPin } from "./card-pin.js";

const cardSelect = {
  id: true, cardNumber: true, serialNumber: true, cardCode: true, balance: true,
  availability: true, cardTypeId: true, cardType: { select: { id: true, name: true } },
  securityCategory: true, state: true,
  swapStatus: true, inventoryStatus: true, createdAt: true, updatedAt: true
} as const;

const cardCopySelect = {
  id: true, clientId: true, cardId: true, cardCopyId: true, lastIndex: true,
  status: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, clientCode: true, name: true } },
  card: { select: cardSelect },
  copyCard: { select: cardSelect }
} as const;

export { DEFAULT_CARD_PIN } from "./card-pin.js";

const serializeCard = <T extends { id: bigint }>(card: T) => ({ ...card, id: card.id.toString() });

const holderClientSelect = { select: { id: true, clientCode: true, name: true } } as const;

/**
 * A listed card with the client holding it, if any: the client of its active
 * assignment as a main card, or as a copy of one.
 */
const cardWithHolderSelect = {
  ...cardSelect,
  originalCards: { where: { status: true }, take: 1, select: { client: holderClientSelect } },
  copyCards: { where: { status: true }, take: 1, select: { client: holderClientSelect } }
} as const;

type CardWithHolder = Prisma.CardGetPayload<{ select: typeof cardWithHolderSelect }>;

const serializeCardWithHolder = ({ originalCards, copyCards, ...card }: CardWithHolder) => {
  const main = originalCards[0]?.client;
  const copy = copyCards[0]?.client;
  return {
    ...serializeCard(card),
    assignedTo: main
      ? { ...main, as: "main" as const }
      : copy ? { ...copy, as: "copy" as const } : null
  };
};
const serializeCopy = <T extends { id: bigint; cardId: bigint; cardCopyId: bigint | null; card: { id: bigint }; copyCard: { id: bigint } | null }>(copy: T) => ({
  ...copy,
  id: copy.id.toString(),
  cardId: copy.cardId.toString(),
  cardCopyId: copy.cardCopyId?.toString() ?? null,
  card: serializeCard(copy.card),
  copyCard: copy.copyCard ? serializeCard(copy.copyCard) : null
});

export class CardsRepository {
  /** The default PIN, already hashed: what every new assignment starts with. */
  private defaultPin: string;

  /** `pinSecret` is `PIN_HMAC_SECRET`: card PINs are stored hashed with it, never as digits. */
  constructor(private db: PrismaClient, private pinSecret: string) {
    this.defaultPin = hashCardPin(DEFAULT_CARD_PIN, pinSecret);
  }

  private pinHash(pin: string | undefined) {
    return pin ? hashCardPin(pin, this.pinSecret) : this.defaultPin;
  }

  async listCards(query: CardListQuery, clientId?: string) {
    const scope: Prisma.CardWhereInput = {
      ...(clientId ? { OR: [{ originalCards: { some: { clientId } } }, { copyCards: { some: { clientId } } }] } : {}),
      ...(query.available === undefined ? {} : { availability: query.available })
    };
    // AND-ed with the client scope, so searching never widens what a client
    // is allowed to see.
    const where: Prisma.CardWhereInput = query.search
      ? {
        AND: [scope, {
          OR: [
            { cardNumber: { contains: query.search } },
            { serialNumber: { contains: query.search } },
            { cardCode: { contains: query.search } },
            // The client holding it, so a client's cards can be found by name.
            { originalCards: { some: { status: true, client: { name: { contains: query.search } } } } },
            { copyCards: { some: { status: true, client: { name: { contains: query.search } } } } }
          ]
        }]
      }
      : scope;
    const [items, total] = await this.db.$transaction([
      this.db.card.findMany({ ...paginationArgs(query), where, orderBy: { createdAt: "desc" }, select: cardWithHolderSelect }),
      this.db.card.count({ where })
    ]);
    return [items.map(serializeCardWithHolder), total] as const;
  }

  async findCard(id: bigint, clientId?: string) {
    const card = await this.db.card.findFirst({
      where: { id, ...(clientId ? { OR: [{ originalCards: { some: { clientId } } }, { copyCards: { some: { clientId } } }] } : {}) },
      select: cardWithHolderSelect
    });
    return card ? serializeCardWithHolder(card) : null;
  }

  /**
   * Transactions made on a card: those recorded on any assignment it is part
   * of, as the main card or as a copy. A main card's include those of its
   * copies' assignments, which are built on it.
   */
  async listTransactions(cardId: bigint, query: CardTransactionQuery) {
    const where: Prisma.CardCopyTransactionWhereInput = {
      cardCopy: { OR: [{ cardId }, { cardCopyId: cardId }] },
      ...(query.startDate || query.endDate
        ? { createdAt: { ...(query.startDate ? { gte: query.startDate } : {}), ...(query.endDate ? { lte: query.endDate } : {}) } }
        : {})
    };
    const [items, total] = await this.db.$transaction([
      this.db.cardCopyTransaction.findMany({
        ...paginationArgs(query),
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true, type: true, direction: true, amount: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true } },
          cardCopy: {
            select: {
              id: true, cardId: true, cardCopyId: true,
              client: { select: { id: true, clientCode: true, name: true } },
              copyCard: { select: { id: true, cardNumber: true } }
            }
          }
        }
      }),
      this.db.cardCopyTransaction.count({ where })
    ]);
    return [items.map(({ cardCopy, ...transaction }) => ({
      ...transaction,
      id: transaction.id.toString(),
      amount: transaction.amount.toFixed(2),
      client: cardCopy.client,
      // Made through a copy of this card rather than on the card itself.
      viaCopy: cardCopy.cardCopyId !== null && cardCopy.cardCopyId !== cardId && cardCopy.copyCard
        ? { id: cardCopy.copyCard.id.toString(), cardNumber: cardCopy.copyCard.cardNumber }
        : null
    })), total] as const;
  }

  async createCard(input: CreateCardInput) {
    await this.assertCardTypes(this.db, [input.cardTypeId]);
    const card = await this.db.card.create({ data: input, select: cardSelect });
    return serializeCard(card);
  }

  async updateCard(id: bigint, input: UpdateCardInput) {
    await this.assertCardTypes(this.db, [input.cardTypeId]);
    const card = await this.db.card.update({ where: { id }, data: input, select: cardSelect });
    return serializeCard(card);
  }

  async deleteCard(id: bigint) {
    const card = await this.db.card.delete({ where: { id }, select: cardSelect });
    return serializeCard(card);
  }

  async listCopies(query: CardCopyListQuery, clientId?: string) {
    const scope: Prisma.CardCopyWhereInput = {
      ...(clientId ? { clientId } : {}),
      ...(query.hasCopy === undefined ? {} : { cardCopyId: query.hasCopy ? { not: null } : null })
    };
    const where: Prisma.CardCopyWhereInput = query.search
      ? {
        AND: [scope, {
          OR: [
            { client: { name: { contains: query.search } } },
            { client: { clientCode: { contains: query.search } } },
            { card: { cardNumber: { contains: query.search } } },
            { card: { serialNumber: { contains: query.search } } },
            { copyCard: { cardNumber: { contains: query.search } } },
            { copyCard: { serialNumber: { contains: query.search } } }
          ]
        }]
      }
      : scope;
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

  /**
   * The card carrying a given serial number, if any — what a binding has to
   * check against, and what names the holder when one is already bound.
   *
   * The client it is assigned to comes along, so a refusal can say who holds
   * the card rather than only that something does.
   */
  async findCardBySerialNumber(serialNumber: string) {
    const card = await this.db.card.findUnique({
      where: { serialNumber },
      select: {
        ...cardSelect,
        originalCards: {
          where: { status: true },
          take: 1,
          select: { client: { select: { id: true, clientCode: true, name: true } } }
        }
      }
    });
    if (!card) return null;
    const { originalCards, ...rest } = card;
    return { ...serializeCard(rest), assignedTo: originalCards[0]?.client ?? null };
  }

  async bindSerialNumber(id: bigint, serialNumber: string | null) {
    const card = await this.db.card.update({ where: { id, serialNumber: undefined }, data: { serialNumber }, select: cardSelect });
    return serializeCard(card);
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
      if (input.cardCopyId) {
        await tx.card.update({ where: { id: input.cardCopyId }, data: { cardTypeId: await this.cardType(tx, input.cardId) } });
      }
      return tx.cardCopy.create({ data: { ...input, pin: this.pinHash(input.pin) }, select: cardCopySelect });
    });
    return serializeCopy(copy);
  }

  /**
   * Sets each card's balance and type — a copy taking its main card's type —
   * then records the main cards and after them the copies, each copy numbered
   * on from the highest copy of its main card. All of it happens or none does:
   * a card taken meanwhile fails the lot.
   */
  async assignCards(input: AssignCardsInput) {
    const assignments = await this.db.$transaction(async (tx) => {
      const cardIds = input.cards.map((card) => card.cardId);
      const reserved = await tx.card.updateMany({
        where: { id: { in: cardIds }, availability: true },
        data: { availability: false, inventoryStatus: 3 }
      });
      if (reserved.count !== cardIds.length) {
        throw new ConflictError("CARD_UNAVAILABLE", "One or more cards are unavailable");
      }
      await this.assertCardTypes(tx, input.cards.map((card) => card.cardTypeId));
      const typeOf = new Map(input.cards
        .filter((card) => card.copyOf === undefined)
        .map((card) => [card.cardId, card.cardTypeId ?? null]));
      for (const card of input.cards) {
        const cardTypeId = card.copyOf === undefined
          ? card.cardTypeId
          : typeOf.has(card.copyOf) ? typeOf.get(card.copyOf) : await this.cardType(tx, card.copyOf);
        await tx.card.update({ where: { id: card.cardId }, data: { cardTypeId, balance: card.balance } });
      }

      const created = [];
      const mains = input.cards.filter((card) => card.copyOf === undefined);
      for (const card of mains) {
        created.push(await tx.cardCopy.create({
          data: { clientId: input.clientId, cardId: card.cardId, pin: this.defaultPin },
          select: cardCopySelect
        }));
      }
      const nextIndex = new Map<bigint, number>();
      for (const card of input.cards) {
        if (card.copyOf === undefined) continue;
        let last = nextIndex.get(card.copyOf);
        if (last === undefined) {
          const { _max } = await tx.cardCopy.aggregate({ where: { cardId: card.copyOf }, _max: { lastIndex: true } });
          last = _max.lastIndex ?? 0;
        }
        nextIndex.set(card.copyOf, last + 1);
        created.push(await tx.cardCopy.create({
          data: { clientId: input.clientId, cardId: card.copyOf, cardCopyId: card.cardId, pin: this.defaultPin, lastIndex: last + 1 },
          select: cardCopySelect
        }));
      }
      return created;
    });
    return assignments.map(serializeCopy);
  }

  /** Whether the client actively holds a card as a main card. */
  findClientMainCard(clientId: string, cardId: bigint) {
    return this.db.cardCopy.findFirst({ where: { clientId, cardId, status: true }, select: { id: true } });
  }

  async searchClients(query: CardClientQuery, clientId?: string) {
    const scope: Prisma.ClientWhereInput = clientId ? { id: clientId } : {};
    const where: Prisma.ClientWhereInput = query.search
      ? {
        AND: [scope, {
          OR: [
            { name: { contains: query.search } },
            { email: { contains: query.search } },
            { clientCode: { contains: query.search } }
          ]
        }]
      }
      : scope;
    const [items, total] = await this.db.$transaction([
      this.db.client.findMany({
        ...paginationArgs(query),
        where,
        orderBy: { name: "asc" },
        select: {
          id: true, clientCode: true, name: true, email: true, phone: true, status: true,
          _count: { select: { cardCopies: { where: { status: true } } } }
        }
      }),
      this.db.client.count({ where })
    ]);
    return [
      items.map(({ _count, ...client }) => ({ ...client, activeAssignments: _count.cardCopies })),
      total
    ] as const;
  }

  findClientSummary(id: string) {
    return this.db.client.findUnique({ where: { id }, select: { id: true, clientCode: true, name: true, email: true, phone: true } });
  }

  async listClientAssignments(clientId: string) {
    const rows = await this.db.cardCopy.findMany({
      where: { clientId },
      orderBy: [{ cardId: "asc" }, { lastIndex: "asc" }, { id: "asc" }],
      select: cardCopySelect
    });
    return rows.map(serializeCopy);
  }

  async updateCopy(id: bigint, { pin, ...input }: UpdateCardCopyInput) {
    const copy = await this.db.cardCopy.update({
      where: { id }, data: { ...input, ...(pin ? { pin: this.pinHash(pin) } : {}) }, select: cardCopySelect,
    });
    return serializeCopy(copy);
  }

  /** Sets an assignment's PIN, or puts it back to the default when none is given. */
  async setPin(id: bigint, pin?: string) {
    const copy = await this.db.cardCopy.update({ where: { id }, data: { pin: this.pinHash(pin) }, select: cardCopySelect });
    return serializeCopy(copy);
  }

  async assignCopyCard(id: bigint, cardCopyId: bigint) {
    const copy = await this.db.$transaction(async (tx) => {
      const assignment = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { cardId: true, cardCopyId: true, status: true } });
      await tx.card.update({ where: { id: cardCopyId }, data: { cardTypeId: await this.cardType(tx, assignment.cardId) } });
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

  /**
   * One new assignment per copy card, sharing the base assignment's client,
   * main card and PIN, and numbered on from the highest copy of that card.
   */
  async addCopyCards(id: bigint, cardCopyIds: bigint[]) {
    const copies = await this.db.$transaction(async (tx) => {
      const base = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { clientId: true, cardId: true, pin: true } });
      const reserved = await tx.card.updateMany({
        where: { id: { in: cardCopyIds }, availability: true },
        data: { availability: false, inventoryStatus: 3 }
      });
      if (reserved.count !== cardCopyIds.length) {
        throw new ConflictError("CARD_UNAVAILABLE", "One or more copy cards are unavailable");
      }
      // A copy is the same kind of card as its main card.
      await tx.card.updateMany({ where: { id: { in: cardCopyIds } }, data: { cardTypeId: await this.cardType(tx, base.cardId) } });
      const { _max } = await tx.cardCopy.aggregate({ where: { cardId: base.cardId }, _max: { lastIndex: true } });
      const lastIndex = _max.lastIndex ?? 0;
      return Promise.all(cardCopyIds.map((cardCopyId, index) => tx.cardCopy.create({
        // A new copy starts with its assignment's PIN (already hashed), or the default.
        data: { ...base, pin: base.pin ?? this.defaultPin, cardCopyId, lastIndex: lastIndex + index + 1 },
        select: cardCopySelect
      })));
    });
    return copies.map(serializeCopy);
  }

  /** A card's type, which its copies take on. */
  private async cardType(tx: Prisma.TransactionClient, cardId: bigint) {
    const card = await tx.card.findUniqueOrThrow({ where: { id: cardId }, select: { cardTypeId: true } });
    return card.cardTypeId;
  }

  /** Every card type named must exist and be active; a switched-off type is not handed out. */
  private async assertCardTypes(db: Prisma.TransactionClient | PrismaClient, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return;
    const types = await db.cardType.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true, status: true } });
    if (types.length !== wanted.length) throw new NotFoundError("Card type");
    const inactive = types.find((type) => type.status !== "active");
    if (inactive) throw new BusinessError("CARD_TYPE_INACTIVE", `The card type ${inactive.name} is switched off`);
  }

  /** Another active assignment on the same main card, if any. */
  private findActiveSibling(tx: Prisma.TransactionClient, id: bigint, cardId: bigint) {
    return tx.cardCopy.findFirst({ where: { id: { not: id }, cardId, status: true }, select: { clientId: true } });
  }

  async changeCopyStatus(id: bigint, status: boolean) {
    const copy = await this.db.$transaction(async (tx) => {
      const assignment = await tx.cardCopy.findUniqueOrThrow({ where: { id }, select: { clientId: true, cardId: true, cardCopyId: true } });
      const sibling = await this.findActiveSibling(tx, id, assignment.cardId);
      if (status && sibling && sibling.clientId !== assignment.clientId) {
        throw new ConflictError("CARD_ALREADY_ASSIGNED", "Card is already assigned to a client");
      }
      // The main card stays reserved while any other copy of it is active.
      const cardIds = [...(sibling ? [] : [assignment.cardId]), ...(assignment.cardCopyId ? [assignment.cardCopyId] : [])];
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
        const sibling = await this.findActiveSibling(tx, id, assignment.cardId);
        await tx.card.updateMany({
          where: { id: { in: [...(sibling ? [] : [assignment.cardId]), ...(assignment.cardCopyId ? [assignment.cardCopyId] : [])] } },
          data: { availability: true, inventoryStatus: 1 }
        });
      }
      return deleted;
    });
    return serializeCopy(copy);
  }
}
