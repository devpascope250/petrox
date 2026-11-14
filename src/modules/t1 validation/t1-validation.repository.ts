import type { ExtraT1ValidationStatus, Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { recordStage } from "../nominations/nomination-stage.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { assertT1WithinCargo } from "../stock/stock-taken.js";
import { NominationRepository } from "../nominations/nominations.repository.js";
import {
  T1ListQuery, CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema,
  T1RaiseOrdersQuery, T1RaiseTripsQuery, T1RaiseVehiclesQuery,
} from "./t1-validation.schema.js";
import { t1Ceilings, t1HeadroomFrom } from "../stock/stock-taken.js";
export class T1ValidationRepository {
  constructor(private db: PrismaClient) {}
  async listByCompleted() {
    return await this.db.t1Validation.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        extraValidations: { some: { status: "confirmed" } },
        // A confirmed T1 validation must be selectable only until it has been
        // used to create central stock.
        centralStocks: { none: {} },
      },
      select: {
        id: true,
        exportingCountry: true,
        // What the T1 clears, at 20 °C: what can go into stock, not the
        // nomination's ambient quantity.
        quantityAt20C: true,
        /** The customs declaration it was cleared under. */
        sdReference: true,
        /** Where the load is said to have come from. Reference only. */
        cargo: { select: { id: true, vesselName: true, blRef: true } },
        extraValidations: true,
        supportingDocUrl: true,
        nomination: {
          select: {
            id: true,
            ambQuantity: true,
            timeLine: true,
            // A nomination can load from several vessels now, so the stock and
            // its item come through the vessel list rather than one `stock`.
            nominationVessels: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                stockId: true,
                ambQuantity: true,
                stock: {
                  select: {
                    item: true
                  }
                }
              }
            }
          }
        }
      },
    });
  }

  /** One page of the T1 validations in the window, with the total behind it. */
  async list(query: T1ListQuery & { startDate: Date; endDate: Date }) {
    const term = query.search?.trim();
    const where: Prisma.T1ValidationWhereInput = {
      createdAt: { gte: query.startDate, lte: query.endDate },
      ...(term
        ? {
            OR: [
              { exportingCountry: { contains: term } },
              { sdReference: { contains: term } },
              { nomination: { destination: { contains: term } } },
              { nomination: { driverVehicle: { driver: { names: { contains: term } } } } },
              { nomination: { driverVehicle: { vechile: { platNumber: { contains: term } } } } },
              { nomination: { driverVehicle: { vechile: { trailerNumber: { contains: term } } } } },
              // The ship it came off, and its bill of lading — two relations
              // down, through the batches the trip loaded from.
              { nomination: { nominationVessels: { some: {
                stock: { cargo: { vesselName: { contains: term } } } } } } },
              { nomination: { nominationVessels: { some: {
                stock: { cargo: { blRef: { contains: term } } } } } } },
              // And the origin the T1 names itself, which may be another ship
              // than the batches its trip drew on.
              { cargo: { vesselName: { contains: term } } },
              { cargo: { blRef: { contains: term } } },
            ],
          }
        : {}),
    };
    return this.db.$transaction([
      this.db.t1Validation.findMany({
      where,
      ...paginationArgs(query),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        exportingCountry: true,
        // What the T1 clears, at 20 °C: what can go into stock, not the
        // nomination's ambient quantity.
        quantityAt20C: true,
        /** The customs declaration it was cleared under. */
        sdReference: true,
        /**
         * The shipment this T1's fuel is said to have come off. Reference
         * only — the litres are drawn from the nomination's own batches — and
         * it is what tells a T1 off the cargo the trip loaded from one off a
         * different cargo.
         */
        cargo: { select: { id: true, vesselName: true, blRef: true } },
        extraValidations: true,
        supportingDocUrl: true,
        nomination: {
          select: {
            id: true,
            ambQuantity: true,
            destination: true,
            expectedLoadingDate: true,
            createdAt: true,
            timeLine: true,
            /*
             * The truck and the man driving it. A T1 is read as a row of a
             * loading list — truck, trailer, driver, licence, passport — so
             * the list carries them rather than making the page fetch a
             * nomination for each of its rows.
             */
            driverVehicle: {
              select: {
                id: true,
                driver: {
                  select: {
                    id: true, names: true, phone: true, lisence: true, passport: true,
                    transport: { select: { id: true, name: true } },
                  },
                },
                vechile: {
                  select: {
                    id: true, platNumber: true, truckNumber: true, trailerNumber: true,
                    tankCapacity: true,
                  },
                },
              },
            },
            // A nomination can load from several vessels now, so the stock and
            // its item come through the vessel list rather than one `stock`.
            nominationVessels: {
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                stockId: true,
                ambQuantity: true,
                stock: {
                  select: {
                    item: true,
                    // The ship it came in on, its BL and the order behind it:
                    // what a loading list is headed with.
                    cargo: {
                      select: {
                        id: true, vesselName: true, blRef: true,
                        order: { select: { id: true, orderCode: true, name: true } },
                      },
                    },
                  }
                }
              }
            }
          }
        }
      },
    }),
      this.db.t1Validation.count({ where }),
    ]);
  }

  /**
   * A T1 against a trip. **Several are allowed**: a load may be cleared on more
   * than one declaration, or a second raised after a correction, and what the
   * trip took out of its batch is the sum of them. The guard that refused a
   * second one has gone with the unique index it was defending.
   */
  /**
   * A T1 against a trip.
   *
   * `cargoId` says which shipment the fuel came off. When it names one the trip
   * has **not** nominated, the trip is put on it first: a line is added for
   * that batch, and the T1 then draws its litres off that shipment rather than
   * off whatever the trip had nominated before. The two are one transaction,
   * because a line added without its T1 would leave fuel nominated off a batch
   * nobody was cleared for.
   *
   * Naming nothing is still allowed and still means what it always did — the
   * figure is spread across the trip's batches — which is how every row raised
   * before this existed is read.
   */
  async create(data: CreateT1ValidationsSchema) {
    /*
     * Whether a line has to be added decides the isolation level, so it is
     * asked before the transaction opens. The guards inside re-check, so a
     * line appearing in between costs an added line at worst, not a bad figure.
     */
    const needsLine = Boolean(data.cargoId) && !(await this.lineFor(data.nominationId, data.cargoId!));

    return await this.db.$transaction(async(tx) => {
      if (needsLine) {
        const batch = await tx.stock.findFirst({
          where: { cargoId: data.cargoId!, status: { notIn: ["returned", "cancelled"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (!batch) {
          throw new BusinessError(
            "CARGO_HAS_NO_BATCH",
            "That shipment has no batch at a depot to load from, so a trip cannot draw on it. "
            + "Approve the shipment first.",
            422,
          );
        }
        /*
         * The ambient litres that went in. The T1's own figure unless told
         * otherwise: at the border nobody has a second measurement, and a
         * 20 °C figure is the closest thing to one.
         *
         * Goes through the nomination's own guarded path, so the batch's
         * capacity, the one-product rule and the truck's tank all still hold.
         */
        await new NominationRepository(this.db).addVesselsWithin(tx, data.nominationId, [{
          stockId: batch.id,
          ambQuantity: data.cargoAmbQuantity ?? data.quantityAt20C,
        }]);
      }

      /*
       * A T1 is what moves the litres, so it is held to the shipment's own
       * figure: a trip cannot be cleared for more than the batches it loaded
       * from still hold. The nomination was checked when it was raised; until
       * now the T1 was checked against nothing, and a mistyped one drew fuel
       * that was never there.
       *
       * After the line is added, not before — a T1 naming a shipment is judged
       * against that shipment, which has to be on the trip to be found.
       */
      await assertT1WithinCargo(tx, data.nominationId, data.quantityAt20C, undefined, data.cargoId);
      // Through `recordStage`, so a stage already passed is not written again.
      await recordStage(tx, data.nominationId, "t1Pending", data.createdBy);
      return await tx.t1Validation.create({
      data: {
        exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        /*
         * Where the load came off. Load-bearing when set: the litres are drawn
         * off this shipment alone rather than spread over the trip. Null keeps
         * the spreading, which is how every older row is read.
         */
        cargoId: data.cargoId ?? null,
        quantityAt20C: data.quantityAt20C,
        sdReference: data.sdReference,
        extraValidations: {
          create: {
            customOffice: data.customOffice,
            // transitNumbering: data.transitNumbering
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
    }, needsLine ? { isolationLevel: "Serializable" } : undefined)
  }

  /** The trip's line on a shipment, if it has one. */
  private lineFor(nominationId: string, cargoId: string) {
    return this.db.nominationVessel.findFirst({
      where: { nominationId, stock: { cargoId } },
      select: { id: true },
    });
  }

  async createExtraT1(data: CreateExtraT1ValidationsSchema) {
      return await this.db.extraT1Validation.create({
      data: {
        t1ValidationId: data.t1ValidationId,
        customOffice: data.customOffice,
        // transitNumbering: data.transitNumbering
      },
    });
  }

  async update(id: string, extraT1Id: string, data: CreateT1ValidationsSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    // The same ceiling as on create, with this T1's own old figure left out of
    // the comparison — otherwise correcting one downwards could be refused by
    // the very quantity being corrected.
    await assertT1WithinCargo(this.db, data.nominationId, data.quantityAt20C, id, data.cargoId);
    return await this.db.t1Validation.update({
      where: { id: id },
     data: {
       exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        cargoId: data.cargoId ?? null,
        quantityAt20C: data.quantityAt20C,
        sdReference: data.sdReference,
        extraValidations: {
          update: {
            where: {id: extraT1Id},
            data: {customOffice: data.customOffice}
          }
        },
        supportingDocUrl: data.supportingDocUrl
      },
    });
  }

  /**
   * Confirms or cancels one customs check.
   *
   * **Cancelling gives the fuel back.** Recording a T1 takes litres off the
   * depot batch, so a cancelled one has to stop drawing them — a declaration
   * withdrawn at the border leaves the fuel where it was. One cancelled check
   * cancels the T1, which is the rule the list already shows on screen, and
   * `stock-taken` reads it the same way.
   *
   * The one thing that cannot be given back is fuel already received into
   * central stock on the strength of this T1. By then the litres are in another
   * batch with their own clearances and draws behind them, and releasing the
   * depot batch as well would have the same fuel in two places.
   */
  async changeStatus(id: string, stat: ExtraT1ValidationStatus, createdBy?: string) {
    const t1 = await this.findExt(id);
    if (!t1) throw new NotFoundError();
    if(t1.status !== "pending") throw new BusinessError("400", "The Status Can not be changed since is not pending")
    if (stat === "cancelled") {
      const receipts = await this.db.centralStock.count({ where: { t1ValidationId: t1.t1ValidationId } });
      if (receipts > 0) {
        throw new BusinessError(
          "T1_RECEIVED",
          `This T1 has already been received into central stock on ${receipts} receipt(s). `
          + "Cancelling it would release the depot batch while those litres are still counted, "
          + "so the receipt has to be dealt with first.",
          422,
        );
      }
    }
      return await this.db.$transaction( async(tx) => {
     // Confirmed by customs; the trip is marked in transit by hand after this.
     await recordStage(tx, t1.validation.nominationId, "t1Confirmed", createdBy);

       return await tx.extraT1Validation.update({
      where: { id },
      data: { status: stat },
    });
    })
     
  }

  find(id: string) {
    return this.db.t1Validation.findUnique({ where: { id } });
  }

  /**
   * ⚠️ A trip may hold **several** T1s, so this is the first of them and not
   * "the" one. Use it only where any T1 will do — anything counting litres
   * must sum them.
   */
  async findByNomination(id: string) {
    return await this.db.t1Validation.findFirst({ where: { nominationId: id } });
  }

   findExt(id: string) {
    return this.db.extraT1Validation.findUnique({ where: { id }, select: {t1ValidationId: true, id: true, status: true, validation: {select: {nominationId: true}}} });
  }

}

/* ------------------------------------------------------------------------- *
 * Finding the trip to raise a T1 against — see the schemas for why.
 * ------------------------------------------------------------------------- */

export class T1RaiseRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Orders with fuel actually on the road: those whose shipments have batches a
   * trip has nominated from. An order nobody has loaded against cannot have a
   * T1, so offering it would only be a dead end.
   */
  async orders(query: T1RaiseOrdersQuery) {
    const term = query.search?.trim();
    const where: Prisma.OrderWhereInput = {
      cargos: { some: { stocks: { some: { nominationVessels: { some: {} } } } } },
      ...(term
        ? {
            OR: [
              { orderCode: { contains: term } },
              { name: { contains: term } },
              { supplier: { name: { contains: term } } },
              { item: { name: { contains: term } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.order.findMany({
        where,
        ...paginationArgs(query),
        orderBy: { orderDate: "desc" },
        select: {
          id: true,
          orderCode: true,
          name: true,
          orderDate: true,
          quantity: true,
          item: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          // What there is to go at: the ships under this order, named the way
          // a T1 names them.
          cargos: {
            where: { stocks: { some: { nominationVessels: { some: {} } } } },
            orderBy: { receivedDate: "desc" },
            select: { id: true, vesselName: true, blRef: true, quantityInLitre: true },
          },
        },
      }),
      this.db.order.count({ where }),
    ]);
    return [items, total] as const;
  }

  /**
   * The trucks nominated on an order's shipments — or on anything at all, when
   * no order is given, so a plate read off the document can be typed straight
   * in.
   *
   * Returned as the **driver-and-vehicle assignment**, because that is what a
   * nomination is made against: the same plate under a different driver is a
   * different thing to clear.
   */
  async vehicles(query: T1RaiseVehiclesQuery) {
    const term = query.search?.trim();
    const onOrder: Prisma.NominationWhereInput = query.orderId
      ? { nominationVessels: { some: { stock: { cargo: { orderId: query.orderId } } } } }
      : {};
    const where: Prisma.DriverVehiclesWhereInput = {
      nominations: { some: onOrder },
      ...(term
        ? {
            OR: [
              { vechile: { platNumber: { contains: term } } },
              { vechile: { trailerNumber: { contains: term } } },
              { vechile: { truckNumber: { contains: term } } },
              { driver: { names: { contains: term } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.driverVehicles.findMany({
        where,
        ...paginationArgs(query),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          driver: {
            select: {
              id: true, names: true, phone: true, lisence: true, passport: true,
              transport: { select: { id: true, name: true } },
            },
          },
          vechile: {
            select: {
              id: true, platNumber: true, truckNumber: true, trailerNumber: true,
              tankCapacity: true,
            },
          },
          /*
           * How many of this truck's trips under the order still have no T1 —
           * what the clerk is looking for, so the list can be read without
           * opening each one. A cancelled T1 does not count as one: the trip
           * needs clearing again.
           */
          _count: {
            select: {
              nominations: {
                where: {
                  ...onOrder,
                  t1Validations: {
                    none: { extraValidations: { none: { status: "cancelled" } } },
                  },
                },
              },
            },
          },
        },
      }),
      this.db.driverVehicles.count({ where }),
    ]);
    return [items, total] as const;
  }

  /**
   * The trips a T1 can be raised against, with what each one still has room
   * for.
   *
   * Every line the trip loads from comes back named the way the customs
   * document names it — ship, BL, ambient litres drawn — together with what
   * that shipment will still clear, so the choice is made in the list rather
   * than discovered when the form is refused.
   */
  async trips(query: T1RaiseTripsQuery) {
    const term = query.search?.trim();
    const where: Prisma.NominationWhereInput = {
      ...(query.driverVehicleId ? { driverVehicleId: query.driverVehicleId } : {}),
      ...(query.orderId
        ? { nominationVessels: { some: { stock: { cargo: { orderId: query.orderId } } } } }
        : {}),
      /*
       * Only trips with no live T1, when asked. A cancelled one does not count:
       * the fuel went back on the batch and the trip needs clearing again.
       */
      ...(query.withoutT1
        ? { t1Validations: { none: { extraValidations: { none: { status: "cancelled" } } } } }
        : {}),
      ...(term
        ? {
            OR: [
              { destination: { contains: term } },
              { driverVehicle: { driver: { names: { contains: term } } } },
              { driverVehicle: { vechile: { platNumber: { contains: term } } } },
              { driverVehicle: { vechile: { trailerNumber: { contains: term } } } },
              { driverVehicle: { vechile: { truckNumber: { contains: term } } } },
              { nominationVessels: { some: { stock: { cargo: { vesselName: { contains: term } } } } } },
              { nominationVessels: { some: { stock: { cargo: { blRef: { contains: term } } } } } },
              { nominationVessels: { some: { stock: { cargo: { order: { orderCode: { contains: term } } } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.nomination.findMany({
        where,
        ...paginationArgs(query),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          ambQuantity: true,
          destination: true,
          expectedLoadingDate: true,
          createdAt: true,
          driverVehicle: {
            select: {
              id: true,
              driver: { select: { id: true, names: true, phone: true, lisence: true, passport: true } },
              vechile: {
                select: {
                  id: true, platNumber: true, truckNumber: true, trailerNumber: true,
                  tankCapacity: true,
                },
              },
            },
          },
          nominationVessels: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              stockId: true,
              ambQuantity: true,
              stock: {
                select: {
                  id: true,
                  cargoId: true,
                  status: true,
                  item: { select: { id: true, name: true } },
                  cargo: {
                    select: {
                      id: true, vesselName: true, blRef: true, quantityInLitre: true,
                      order: { select: { id: true, orderCode: true, name: true } },
                    },
                  },
                },
              },
            },
          },
          // What is already on it, so a second declaration can be read against
          // the first rather than guessed at.
          t1Validations: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              quantityAt20C: true,
              sdReference: true,
              cargoId: true,
              exportingCountry: true,
              createdAt: true,
              extraValidations: { select: { id: true, customOffice: true, status: true } },
            },
          },
          timeLine: {
            orderBy: { timeLineStatus: { level: "desc" } },
            take: 1,
            select: { timeLineStatus: { select: { status: true, level: true } } },
          },
        },
      }),
      this.db.nomination.count({ where }),
    ]);

    // One query for the page's batches, not one per trip.
    const ceilings = await t1Ceilings(this.db, rows.map((row) => row.id));
    const items = rows.map((row) => {
      const batches = ceilings.get(row.id) ?? [];
      return {
        ...row,
        /** The most a T1 naming no shipment may say. See `t1HeadroomFrom`. */
        t1Headroom: t1HeadroomFrom(batches),
        /*
         * Per shipment the trip loads from: what it holds, what has been
         * cleared off it, and what a T1 naming it may still say. The last is
         * what the clerk needs — a shipment with nothing left cannot take
         * another declaration, whatever the trip's totals look like.
         */
        vessels: row.nominationVessels.map((line) => {
          const batch = batches.find((entry) => entry.stockId === line.stockId);
          return {
            vesselId: line.id,
            stockId: line.stockId,
            cargoId: line.stock.cargoId,
            vesselName: line.stock.cargo?.vesselName ?? null,
            blRef: line.stock.cargo?.blRef ?? null,
            order: line.stock.cargo?.order ?? null,
            itemName: line.stock.item.name,
            /** Ambient litres this trip drew off this shipment. */
            nominatedAmbient: Number(line.ambQuantity),
            batchQuantity: batch?.quantity ?? Number(line.stock.cargo?.quantityInLitre ?? 0),
            cleared: batch?.taken ?? 0,
            /** What a T1 naming this shipment may still say. */
            clearable: batch?.attributedCeiling ?? 0,
          };
        }),
      };
    });
    return [items, total] as const;
  }
}
