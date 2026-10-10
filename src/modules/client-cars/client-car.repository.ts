import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/pagination.js";
import type { ClientCarListQuery, CreateClientCar, UpdateClientCar } from "./client-car.schema.js";

type Db = PrismaClient | Prisma.TransactionClient;

const physicalCard = { select: { id: true, cardNumber: true, serialNumber: true, cardType: { select: { id: true, name: true } } } } as const;

/** A client's card as a car sees it: the physical card it is, main or copy. */
const cardCopySelect = {
  id: true, clientId: true, status: true, lastIndex: true, cardCopyId: true,
  card: physicalCard, copyCard: physicalCard,
} satisfies Prisma.CardCopySelect;

function presentCard(row: Prisma.CardCopyGetPayload<{ select: typeof cardCopySelect }>) {
  const { card, copyCard, ...rest } = row;
  // With `cardCopyId` set the client holds a copy of `card`; otherwise `card` itself.
  const physical = copyCard ?? card;
  return {
    ...rest,
    id: rest.id.toString(),
    cardCopyId: rest.cardCopyId?.toString() ?? null,
    isCopy: Boolean(copyCard),
    cardNumber: physical.cardNumber,
    serialNumber: physical.serialNumber,
    cardType: card.cardType,
  };
}

const assignmentSelect = {
  id: true, clientCarId: true, assignedAt: true, unassignedAt: true, status: true,
  cardCopy: { select: cardCopySelect },
} satisfies Prisma.ClientCarCardAssignmentSelect;

function presentAssignment({ cardCopy, ...row }: Prisma.ClientCarCardAssignmentGetPayload<{ select: typeof assignmentSelect }>) {
  return { ...row, card: presentCard(cardCopy) };
}

const carSelect = {
  id: true, clientId: true, plateNo: true, trackNo: true, tancapacity: true, status: true, createdAt: true, updatedAt: true,
  itemId: true, item: { select: { id: true, name: true, baseUnit: { select: { id: true, code: true } } } },
  client: { select: { id: true, clientCode: true, name: true, status: true } },
  clientCarCardAssignments: { where: { status: "active" }, select: assignmentSelect, orderBy: { assignedAt: "asc" } },
} satisfies Prisma.ClientCarSelect;

function presentCar({ clientCarCardAssignments, ...car }: Prisma.ClientCarGetPayload<{ select: typeof carSelect }>) {
  return {
    ...car,
    tancapacity: Number(car.tancapacity),
    /** The cards on the car now. A car can carry several cards. */
    activeAssignments: clientCarCardAssignments.map(presentAssignment),
  };
}

/**
 * A plate belongs to one active car at a time. Switched-off cars keep theirs,
 * so a car sold on can be registered again under its new owner.
 */
export async function assertPlatesFree(db: Db, plates: string[], exceptCarId?: string) {
  const seen = new Set<string>();
  for (const plate of plates) {
    if (seen.has(plate)) throw new ConflictError("PLATE_REPEATED", `The plate ${plate} is listed twice`);
    seen.add(plate);
  }
  if (plates.length === 0) return;
  const taken = await db.clientCar.findFirst({
    where: { plateNo: { in: plates }, status: "active", id: exceptCarId ? { not: exceptCarId } : undefined },
    select: { plateNo: true },
  });
  if (taken) throw new ConflictError("PLATE_TAKEN", `An active car with the plate ${taken.plateNo} is already registered`);
}

/**
 * A car runs on a product: an active item that is not a group of others
 * (AGO or PMS, say — not "Fuel" or "Diesel").
 */
export async function assertCarItems(db: Db, itemIds: string[]) {
  const wanted = [...new Set(itemIds)];
  if (wanted.length === 0) return;
  const items = await db.item.findMany({
    where: { id: { in: wanted } }, select: { id: true, name: true, status: true, _count: { select: { items: true } } },
  });
  if (items.length !== wanted.length) throw new NotFoundError("Item");
  const inactive = items.find((item) => item.status !== "active");
  if (inactive) throw new BusinessError("ITEM_INACTIVE", `${inactive.name} is not active`);
  const group = items.find((item) => item._count.items > 0);
  if (group) throw new BusinessError("ITEM_IS_GROUP", `${group.name} is a group of products; choose one of its products`);
}

/** Cars are never deleted: a car no longer used is switched off, and its history kept. */
export class ClientCarRepository {
  constructor(private db: PrismaClient) {}

  async list(query: ClientCarListQuery, clientId?: string) {
    const where: Prisma.ClientCarWhereInput = {
      clientId: clientId ?? query.clientId,
      status: query.status,
      ...(query.search ? { OR: [{ plateNo: { contains: query.search.replace(/[\s-]+/g, "") } }, { trackNo: { contains: query.search } }] } : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.clientCar.findMany({ where, select: carSelect, ...paginationArgs(query), orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
      this.db.clientCar.count({ where }),
    ]);
    return paginatedData(rows.map(presentCar), total, query);
  }

  async find(id: string) {
    const car = await this.db.clientCar.findUnique({ where: { id }, select: carSelect });
    if (!car) throw new NotFoundError("Car");
    return presentCar(car);
  }

  /** The car with every card it has carried, newest first. */
  async findWithHistory(id: string) {
    const car = await this.find(id);
    const history = await this.db.clientCarCardAssignment.findMany({
      where: { clientCarId: id }, select: assignmentSelect, orderBy: { assignedAt: "desc" },
    });
    return { ...car, assignments: history.map(presentAssignment) };
  }

  /** The products a car can run on: active items that are not groups of others. */
  async items() {
    const items = await this.db.item.findMany({
      where: { status: "active", items: { none: {} } },
      select: { id: true, name: true, baseUnit: { select: { id: true, code: true } }, itemClass: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
    return items.map(({ itemClass, ...item }) => ({ ...item, parent: itemClass }));
  }

  /** Client organisations to pick from, with how many active cars each has. */
  async clients(search: string | undefined, clientId?: string) {
    const rows = await this.db.client.findMany({
      where: {
        id: clientId,
        ...(search ? { OR: [{ name: { contains: search } }, { clientCode: { contains: search } }] } : {}),
      },
      select: { id: true, clientCode: true, name: true, status: true,
        _count: { select: { clientCars: { where: { status: "active" } } } } },
      orderBy: [{ name: "asc" }, { clientCode: "asc" }],
      take: 100,
    });
    return rows.map(({ _count, ...client }) => ({ ...client, activeCars: _count.clientCars }));
  }

  findClient(id: string) {
    return this.db.client.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  }

  async create(input: CreateClientCar) {
    return this.db.$transaction(async (tx) => {
      await assertPlatesFree(tx, [input.plateNo]);
      await assertCarItems(tx, [input.itemId]);
      const car = await tx.clientCar.create({ data: input, select: carSelect });
      return presentCar(car);
    });
  }

  async update(id: string, input: UpdateClientCar) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.clientCar.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundError("Car");
      if (input.plateNo && current.status === "active") await assertPlatesFree(tx, [input.plateNo], id);
      if (input.itemId) await assertCarItems(tx, [input.itemId]);
      const car = await tx.clientCar.update({ where: { id }, data: input, select: carSelect });
      return presentCar(car);
    });
  }

  /**
   * Switches a car on or off. Switching it off takes its cards off it too;
   * switching it back on needs its plate to be free again.
   */
  async changeStatus(id: string) {
    return this.db.$transaction(async (tx) => {
      const current = await tx.clientCar.findUnique({ where: { id }, select: { status: true, plateNo: true } });
      if (!current) throw new NotFoundError("Car");
      const status = current.status === "active" ? "inactive" : "active";
      if (status === "inactive") {
        await tx.clientCarCardAssignment.updateMany({
          where: { clientCarId: id, status: "active" }, data: { status: "inactive", unassignedAt: new Date() },
        });
      } else {
        await assertPlatesFree(tx, [current.plateNo], id);
      }
      const car = await tx.clientCar.update({ where: { id }, data: { status }, select: carSelect });
      return presentCar(car);
    });
  }

  /** A client's active cards, each with the cars it is on — what the card picker offers. */
  async clientCards(clientId: string) {
    const cards = await this.db.cardCopy.findMany({
      where: { clientId, status: true },
      select: { ...cardCopySelect,
        clientCarCardAssignments: { where: { status: "active" }, select: { clientCar: { select: { id: true, plateNo: true } } } } },
      orderBy: [{ cardId: "asc" }, { lastIndex: "asc" }],
    });
    return cards.map(({ clientCarCardAssignments, ...card }) => ({
      ...presentCard(card), onCars: clientCarCardAssignments.map((row) => row.clientCar),
    }));
  }

  /**
   * Puts some of the client's active cards on an active car. A car can carry
   * several cards and a card can serve several cars; the same card is only
   * refused when it is already on this car. All or nothing.
   */
  assignCards(carId: string, cardCopyIds: bigint[]) {
    return this.db.$transaction(async (tx) => {
      const car = await tx.clientCar.findUnique({
        where: { id: carId }, select: { id: true, plateNo: true, status: true, clientId: true, client: { select: { status: true } } },
      });
      if (!car) throw new NotFoundError("Car");
      if (car.status !== "active") throw new BusinessError("CAR_INACTIVE", `${car.plateNo} is switched off`);
      if (!car.client.status) throw new BusinessError("CLIENT_INACTIVE", "This client is not active");

      const wanted = [...new Set(cardCopyIds.map(String))].map((id) => BigInt(id));
      const cards = await tx.cardCopy.findMany({ where: { id: { in: wanted } }, select: cardCopySelect });
      if (cards.length !== wanted.length || cards.some((card) => card.clientId !== car.clientId)) {
        throw new NotFoundError("Card for this client");
      }
      if (cards.some((card) => !card.status)) throw new BusinessError("CARD_INACTIVE", "One of those cards is not active");

      const already = await tx.clientCarCardAssignment.findMany({
        where: { clientCarId: carId, cardCopyId: { in: wanted }, status: "active" }, select: { cardCopy: { select: cardCopySelect } },
      });
      if (already.length) {
        const labels = already.map((row) => presentCard(row.cardCopy).cardNumber ?? row.cardCopy.id.toString()).join(", ");
        throw new BusinessError("CARD_ALREADY_ON_CAR", `Already on ${car.plateNo}: ${labels}`);
      }

      const created = [];
      for (const cardCopyId of wanted) {
        created.push(await tx.clientCarCardAssignment.create({ data: { clientCarId: carId, cardCopyId }, select: assignmentSelect }));
      }
      return created.map(presentAssignment);
    });
  }

  /** Takes one card off the car. The card stays with the client, and the car keeps it in its history. */
  async unassignCard(carId: string, cardCopyId: bigint) {
    const current = await this.db.clientCarCardAssignment.findFirst({
      where: { clientCarId: carId, cardCopyId, status: "active" }, select: { id: true },
    });
    if (!current) throw new BusinessError("CARD_NOT_ON_CAR", "That card is not on this car");
    const assignment = await this.db.clientCarCardAssignment.update({
      where: { id: current.id }, data: { status: "inactive", unassignedAt: new Date() }, select: assignmentSelect,
    });
    return presentAssignment(assignment);
  }
}
