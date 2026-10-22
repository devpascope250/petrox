import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { CreateNominationsSchema, NominationListQuerySchema, NominationVesselSchema } from "./nominations.schema.js";

type Tx = Prisma.TransactionClient;

/** Driver and vehicle, shaped the same way on every nomination response. */
const driverVehicleSelect = {
  select: {
    driver: {
      select: { names: true, phone: true, passport: true, lisence: true },
    },
    vechile: {
      select: {
        id: true,
        model: true,
        platNumber: true,
        tankCapacity: true,
        trailerNumber: true,
        truckNumber: true,
        createdAt: true,
      },
    },
  },
} as const;

/**
 * The vessels a nomination loads from. Each one names its stock receipt, so a
 * caller can see the cargo and item behind every part of the nomination.
 */
const vesselsSelect = {
  orderBy: { createdAt: "asc" },
  select: {
    id: true,
    stockId: true,
    ambQuantity: true,
    stock: {
      select: {
        id: true,
        quantity: true,
        receivedDate: true,
        status: true,
        cargo: true,
        // The unit comes with the item, so a caller can label quantities
        // without a second lookup against the units list.
        item: {
          select: {
            id: true,
            name: true,
            descriptions: true,
            parentId: true,
            baseUnitId: true,
            status: true,
            baseUnit: { select: { id: true, name: true, code: true } },
          },
        },
        deport: { select: { id: true, name: true, location: true, type: true } },
      },
    },
  },
} as const;

const nominationSelect = {
  id: true,
  ambQuantity: true,
  destination: true,
  expectedLoadingDate: true,
  driverVehicleId: true,
  createdAt: true,
  updatedAt: true,
  nominationVessels: vesselsSelect,
  driverVehicle: driverVehicleSelect,
  // Whether customs validation has been raised. A PFI invoices the cargo, not
  // the trip, so there is no PFI count here any more.
  _count: { select: { t1Validations: true } },
  // The furthest stage reached, so a list can show progress without fetching
  // every nomination's timeline.
  timeLine: {
    orderBy: { timeLineStatus: { level: "desc" } },
    take: 1,
    select: {
      createdAt: true,
      timeLineStatus: { select: { status: true, level: true } },
    },
  },
} satisfies Prisma.NominationSelect;

/**
 * The detail view adds what the drawer shows beyond a list row: the customs
 * validation raised against the nomination. The list stays lean, since it
 * renders a table.
 */
const nominationDetailSelect = {
  ...nominationSelect,
  t1Validations: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      exportingCountry: true,
      quantityAt20C: true,
      supportingDocUrl: true,
      createdAt: true,
      extraValidations: {
        orderBy: { createdAt: "asc" },
        select: { id: true, customOffice: true, status: true, createdAt: true },
      },
    },
  },
} satisfies Prisma.NominationSelect;

export class NominationRepository {
  constructor(private db: PrismaClient) {}

  /** The nomination's quantity is always the total of its vessels. */
  private totalQuantity(vessels: NominationVesselSchema[]) {
    return vessels.reduce((total, vessel) => total + Number(vessel.ambQuantity), 0);
  }

  /** One page of the nominations in the window, with the total behind it. */
  async list(query: NominationListQuerySchema & { startDate: Date; endDate: Date }) {
    const { startDate, endDate, itemId } = query;
    const where: Prisma.NominationWhereInput = {
      ...(itemId ? { nominationVessels: { some: { stock: { itemId } } } } : {}),
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    };
    return this.db.$transaction([
      this.db.nomination.findMany({
        where,
        ...paginationArgs(query),
        orderBy: { createdAt: "desc" },
        select: nominationSelect,
      }),
      this.db.nomination.count({ where }),
    ]);
  }

  /**
   * Every vessel must fit inside what its stock still has free. `exclude` drops
   * a nomination's own vessels from the running total, so re-saving an
   * unchanged nomination is not blocked by the stock it already holds.
   */
  private async assertStockCapacity(
    tx: Tx,
    vessels: NominationVesselSchema[],
    exclude?: string,
  ) {
    const stocks = await tx.stock.findMany({
      where: { id: { in: vessels.map((vessel) => vessel.stockId) } },
      select: {
        id: true,
        quantity: true,
        item: { select: { name: true } },
        nominationVessels: {
          ...(exclude ? { where: { nominationId: { not: exclude } } } : {}),
          select: { ambQuantity: true },
        },
      },
    });
    const byId = new Map(stocks.map((stock) => [stock.id, stock]));

    for (const vessel of vessels) {
      const stock = byId.get(vessel.stockId);
      if (!stock) throw new NotFoundError("Stock not found");
      const nominated = stock.nominationVessels.reduce(
        (total, row) => total + Number(row.ambQuantity),
        0,
      );
      const remaining = Number(stock.quantity) - nominated;
      if (Number(vessel.ambQuantity) > remaining) {
        throw new BusinessError(
          "400",
          `The Nominations Qty can not be greater than stock quantity! Only ${remaining} ${stock.item.name} remains on this stock`,
        );
      }
    }
  }

  /**
   * A truck cannot carry more than its tank holds. What is already nominated on
   * it and not yet delivered — no `stockReceived` on its timeline — plus what is
   * being added must fit inside `tankCapacity`.
   *
   * `exclude` names a nomination whose current quantity is being replaced, so
   * re-saving it does not count its own load twice.
   */
  private async assertTruckCapacity(
    tx: Tx,
    driverVehicleId: string,
    adding: number,
    exclude?: string,
  ) {
    const assignment = await tx.driverVehicles.findUnique({
      where: { id: driverVehicleId },
      select: {
        vechile: { select: { platNumber: true, tankCapacity: true } },
        nominations: {
          where: {
            ...(exclude && { id: { not: exclude } }),
            timeLine: { none: { timeLineStatus: { status: "stockReceived" } } },
          },
          select: { ambQuantity: true },
        },
      },
    });
    if (!assignment) throw new NotFoundError("Driver and vehicle assignment not found");

    const capacity = new Prisma.Decimal(assignment.vechile.tankCapacity);
    const onTruck = assignment.nominations.reduce(
      (total, row) => total.plus(row.ambQuantity),
      new Prisma.Decimal(0),
    );
    if (onTruck.plus(adding).greaterThan(capacity)) {
      const free = Prisma.Decimal.max(0, capacity.minus(onTruck));
      throw new BusinessError(
        "TANK_CAPACITY_EXCEEDED",
        `Truck ${assignment.vechile.platNumber} holds ${capacity.toString()}. ` +
          `${onTruck.toString()} is already nominated on it, so only ${free.toString()} more fits — ` +
          `${new Prisma.Decimal(adding).toString()} was requested.`,
        422,
        { tankCapacity: capacity.toNumber(), alreadyNominated: onTruck.toNumber(), available: free.toNumber() },
      );
    }
  }

  /**
   * A nomination carries one product. Its vessels may come from different
   * cargos, but they must all hold the same item — a truck is loaded with one
   * thing, and everything downstream (T1, receipt, tolerance) is per item.
   *
   * `existing` names a nomination whose current vessels count too, for when
   * stock is being added to one that already exists.
   */
  private async assertSingleItem(
    tx: Tx,
    vessels: NominationVesselSchema[],
    existing?: string,
  ) {
    const stocks = await tx.stock.findMany({
      where: { id: { in: vessels.map((vessel) => vessel.stockId) } },
      select: { id: true, itemId: true, item: { select: { name: true } } },
    });
    const items = new Map(stocks.map((stock) => [stock.itemId, stock.item.name]));

    if (existing) {
      const onNomination = await tx.nominationVessel.findMany({
        where: { nominationId: existing },
        select: { stock: { select: { itemId: true, item: { select: { name: true } } } } },
      });
      for (const vessel of onNomination) {
        items.set(vessel.stock.itemId, vessel.stock.item.name);
      }
    }

    if (items.size > 1) {
      throw new BusinessError(
        "400",
        `A nomination can only carry one product, but this one mixes ${Array.from(items.values()).join(" and ")}`,
      );
    }
  }

  async create(data: CreateNominationsSchema) {
    const getstatus = await this.db.nominationTimeLineStatus.findFirst({where: {status: "awaiting"}});
    if (!getstatus) throw new NotFoundError("The nomination status must be registered before")
    return await this.db.$transaction(async (tx) => {
      await this.assertSingleItem(tx, data.vessels);
      await this.assertStockCapacity(tx, data.vessels);
      await this.assertTruckCapacity(tx, data.driverVehicleId, this.totalQuantity(data.vessels));
      return await tx.nomination.create({
        data: {
          destination: data.destination,
          // Held on the nomination as the total of its vessels.
          ambQuantity: this.totalQuantity(data.vessels),
          expectedLoadingDate: data.expectedLoadingedDate,
          driverVehicleId: data.driverVehicleId,
          nominationVessels: {
            create: data.vessels.map((vessel) => ({
              stockId: vessel.stockId,
              ambQuantity: vessel.ambQuantity,
            })),
          },
          timeLine: {
            create: {
              timeLineStatusId: getstatus.id,
              changedBy: data.createdBy
            }
          }
        },
        select: nominationSelect,
      });
    }, { isolationLevel: "Serializable" });
  }

  async update(id: string, data: CreateNominationsSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    return await this.db.$transaction(async (tx) => {
      await this.assertSingleItem(tx, data.vessels);
      await this.assertStockCapacity(tx, data.vessels, id);
      // Its own current load is being replaced, so it is left out of the total.
      await this.assertTruckCapacity(tx, data.driverVehicleId, this.totalQuantity(data.vessels), id);
      // The vessel list is replaced wholesale: what the client sends is what
      // the nomination ends up loading from.
      await tx.nominationVessel.deleteMany({ where: { nominationId: id } });
      return await tx.nomination.update({
        where: { id: id },
        data: {
          destination: data.destination,
          ambQuantity: this.totalQuantity(data.vessels),
          expectedLoadingDate: data.expectedLoadingedDate,
          driverVehicleId: data.driverVehicleId,
          nominationVessels: {
            create: data.vessels.map((vessel) => ({
              stockId: vessel.stockId,
              ambQuantity: vessel.ambQuantity,
            })),
          },
        },
        select: nominationSelect,
      });
    }, { isolationLevel: "Serializable" });
  }

  /**
   * Loads more stock onto a nomination that already exists: each vessel is a
   * new row, and the nomination's own quantity grows by their total. Nothing
   * already on the nomination is touched.
   *
   * This used to be refused once the nomination carried a PFI. A PFI now
   * invoices the cargo rather than the trip, so a nomination carries none and
   * there is nothing here to fix its load.
   */
  async addVessels(id: string, vessels: NominationVesselSchema[]) {
    const nomination = await this.db.nomination.findUnique({
      where: { id },
      select: { id: true, driverVehicleId: true },
    });
    if (!nomination) throw new NotFoundError("Nomination not found");
    return await this.db.$transaction(async (tx) => {
      // What the nomination already carries counts here: added stock must be
      // the same product.
      await this.assertSingleItem(tx, vessels, id);
      // A pure addition, so everything already nominated — including this
      // nomination's own vessels — counts against what the stock has left.
      await this.assertStockCapacity(tx, vessels);
      // An addition: what the nomination already carries stays on the truck.
      await this.assertTruckCapacity(tx, nomination.driverVehicleId, this.totalQuantity(vessels));
      await tx.nominationVessel.createMany({
        data: vessels.map((vessel) => ({
          nominationId: id,
          stockId: vessel.stockId,
          ambQuantity: vessel.ambQuantity,
        })),
      });
      return await tx.nomination.update({
        where: { id },
        data: { ambQuantity: { increment: this.totalQuantity(vessels) } },
        select: nominationSelect,
      });
    }, { isolationLevel: "Serializable" });
  }

  find(id: string) {
    return this.db.nomination.findUnique({ where: { id }, select: nominationDetailSelect });
  }

  async findByTimeLine(nominationId: string) {
    const timeLine = await this.db.nominationTimeLine.findMany(
      {
        where: {nominationId},
      select: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          }
        },
        timeLineStatus: {
          select:{
            id: true,
            level: true,
            status: true,
            descriptions: true
          },

        },
        createdAt: true,
      },
      orderBy: {
        timeLineStatus: {
          level: "asc"
        }
      }
      }
    );

    return timeLine.map((entry) => {
      const descriptions = entry.timeLineStatus.descriptions
        .split(",")
        .map((description) => description.trim())
        .filter(Boolean);

      return {
        id: entry.timeLineStatus.id,
        status: entry.timeLineStatus.status,
        level: entry.timeLineStatus.level,
        descriptions,
        createdAt: entry.createdAt,
        createdBy: entry.user
          ? `${entry.user.firstName} ${entry.user.lastName}`.trim()
          : null
      }
    });
  }

}
