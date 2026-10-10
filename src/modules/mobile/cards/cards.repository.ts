import { Prisma, type PrismaClient } from "../../../../prisma/generated/prisma/client.js";
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
import { BusinessError, ConflictError, NotFoundError } from "../../../utils/errors.js";

const cardSelect = {
  id: true, cardNumber: true, serialNumber: true, cardCode: true, balance: true,
  availability: true, cardTypeId: true, cardType: { select: { id: true, name: true, setting: {select: { id: true,allowCredit: true, capturePlatePicture: true, hasLimit: true, limitAmount: true, requireOdometer: true, requirePin: true, requirePlateNumber: true, limitPeriod: true, showBalance: true, captureDisplay: true}} } },
  securityCategory: true, state: true,
  swapStatus: true, inventoryStatus: true, createdAt: true, updatedAt: true
} as const;

/** A card type with the rules its cards follow. */
const cardTypeSelect = {
  select: {
    id: true, name: true,
    setting: { select: { allowCredit: true, capturePlatePicture: true, hasLimit: true, limitAmount: true,
      limitPeriod: true, requireOdometer: true, requirePin: true, requirePlateNumber: true,
      showBalance: true, captureDisplay: true } },
  },
} as const;

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

export class MobileCardsRepository {
  constructor(private db: PrismaClient) {}
  async findCard(id: bigint, clientId?: string) {
    const card = await this.db.card.findFirst({
      where: { id, ...(clientId ? { OR: [{ originalCards: { some: { clientId } } }, { copyCards: { some: { clientId } } }] } : {}) },
      select: cardWithHolderSelect
    });
    return card ? serializeCardWithHolder(card) : null;
  }

  /**
   * The card behind a scanned serial number, as the POS needs it: what it is
   * (a client's main card, a copy of one, or not assigned), who holds it, and
   * the balance it spends from.
   *
   * A copy has no money of its own: it spends from its main card, so for a
   * copy `balance` is the main card's. Only active assignments count.
   * Returns `null` when no card has this serial number.
   */
  async findCardBySerialNumber(serialNumber: string) {
    const physical = { id: true, cardNumber: true, serialNumber: true, balance: true, state: true } as const;
    const holder = { select: { id: true, clientCode: true, name: true, status: true } } as const;
    // The active cars an assignment's card is on — active assignment, active car.
    const cars = {
      where: { status: "active", clientCar: { status: "active" } },
      select: { assignedAt: true, clientCar: { select: { id: true, plateNo: true, trackNo: true, tancapacity: true,
        item: { select: { id: true, name: true } } } } },
      orderBy: { assignedAt: "asc" },
    } satisfies Prisma.CardCopy$clientCarCardAssignmentsArgs;
    const card = await this.db.card.findFirst({
      where: { serialNumber },
      select: {
        ...physical, cardCode: true, availability: true, securityCategory: true, swapStatus: true, inventoryStatus: true,
        cardType: cardTypeSelect,
        // Assignments where this card is the main card (its copies hang off these too).
        originalCards: {
          where: { status: true },
          select: { id: true, lastIndex: true, cardCopyId: true, client: holder,
            copyCard: { select: { id: true, cardNumber: true, serialNumber: true } },
            clientCarCardAssignments: cars },
          orderBy: { lastIndex: "asc" },
        },
        
        // The assignment where this card is a copy, with the main card it copies.
        copyCards: {
          where: { status: true },
          take: 1,
          select: { id: true, lastIndex: true, client: holder, clientCarCardAssignments: cars,
            card: { select: { ...physical, cardType: cardTypeSelect } } },
        },
      },
    });
    if (!card) return null;

    const { originalCards, copyCards, cardType, balance, ...own } = card;
    const asCopy = copyCards[0];
    const asMain = originalCards[0];
    const kind = asCopy ? "copy" as const : asMain ? "main" as const : "unassigned" as const;
    const main = asCopy ? asCopy.card : { ...own, balance };
    // Cars are put on an assignment: for a copy, its own; for a main card, the
    // one where it is held as itself (its copies' cars belong to the copies).
    const holding = asCopy ?? originalCards.find((row) => !row.cardCopyId);

    return {
      ...own,
      id: own.id.toString(),
      /**
       * The assignment (`CardCopy`) that holds this physical card — its copy
       * assignment for a copy, the main one for a main card. What
       * `POST /mobile/cards/verify-pin` takes as `cardCopyId`. `null` when the
       * card is not assigned.
       */
      cardCopyId: holding?.id.toString() ?? null,
      kind,
      isMain: kind === "main",
      isCopy: kind === "copy",
      /** What the card spends from: the main card's balance for a copy, its own otherwise. */
      balance: (asCopy ? asCopy.card.balance : balance).toFixed(2),
      /** The card's own stored balance; a copy's is not used. */
      ownBalance: balance.toFixed(2),
      /** A copy follows its main card's type and rules. */
      cardType: (asCopy ? asCopy.card.cardType : null) ?? cardType,
      client: (asCopy ?? asMain)?.client ?? null,
      /** For a copy: the main card it spends from. For a main card: itself. */
      mainCard: kind === "unassigned" ? null : {
        id: main.id.toString(), cardNumber: main.cardNumber, serialNumber: main.serialNumber,
        balance: main.balance.toFixed(2), state: main.state,
      },
      /** For a copy: which copy of the main card it is. */
      copyIndex: asCopy?.lastIndex ?? null,
      /** The active cars this card is on now. */
      cars: (holding?.clientCarCardAssignments ?? []).map(({ assignedAt, clientCar }) => ({
        ...clientCar, tancapacity: Number(clientCar.tancapacity), assignedAt,
      })),

    };
  }

  /**
   * The active assignment a PIN belongs to. By serial number: the assignment
   * that holds that physical card — as a copy, or as the main card itself.
   */
  findAssignmentForPin(by: { serialNumber?: string; cardCopyId?: bigint }) {
    const select = {
      id: true, pin: true, clientId: true, cardCopyId: true,
      client: { select: { status: true } },
    } as const;
    if (by.cardCopyId) {
      return this.db.cardCopy.findFirst({ where: { id: by.cardCopyId, status: true }, select });
    }
    return this.db.cardCopy.findFirst({
      where: {
        status: true,
        OR: [
          { copyCard: { serialNumber: by.serialNumber } },
          { cardCopyId: null, card: { serialNumber: by.serialNumber } },
        ],
      },
      // A copy's own assignment comes first when the serial is a copy card's.
      orderBy: { cardCopyId: { sort: "desc", nulls: "last" } },
      select,
    });
  }
}
