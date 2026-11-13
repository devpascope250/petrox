import type { ExtraT1ValidationStatus, Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { recordStage } from "../nominations/nomination-stage.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PagedDatesQuery } from "../../shared/validation/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { assertT1WithinCargo } from "../stock/stock-taken.js";
import { T1ListQuery, CreateExtraT1ValidationsSchema, CreateT1ValidationsSchema } from "./t1-validation.schema.js";
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
  async create(data: CreateT1ValidationsSchema) {
    return await this.db.$transaction(async(tx) => {
      /*
       * A T1 is what moves the litres, so it is held to the shipment's own
       * figure: a trip cannot be cleared for more than the batches it loaded
       * from still hold. The nomination was checked when it was raised; until
       * now the T1 was checked against nothing, and a mistyped one drew fuel
       * that was never there.
       */
      await assertT1WithinCargo(tx, data.nominationId, data.quantityAt20C);
      // Through `recordStage`, so a stage already passed is not written again.
      await recordStage(tx, data.nominationId, "t1Pending", data.createdBy);
      return await tx.t1Validation.create({
      data: {
        exportingCountry: data.exportingCountry,
        nominationId: data.nominationId,
        // Reference only — where the load is said to have come from. It is not
        // what the litres are drawn against; the nomination's batches are.
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
    }) 
    
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
    await assertT1WithinCargo(this.db, data.nominationId, data.quantityAt20C, id);
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
