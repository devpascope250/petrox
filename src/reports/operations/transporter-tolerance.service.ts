import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginatedData, paginationArgs } from "../../shared/pagination/index.js";
import { toleranceFor } from "../../modules/central-stock/tolerance-rules.js";
import type { TransporterToleranceReportSchema } from "./transporter-tolerance.schema.js";

const money = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(2));

/** A trip, as the report reads one: the receipt, and everything behind it. */
const tripSelect = {
  id: true, receiptNumber: true, quantityAt20C: true, ambQuantity: true,
  lossQty: true, gainQty: true, toleranceRate: true, status: true, createdAt: true,
  item: { select: { id: true, name: true } },
  deport: { select: { id: true, name: true } },
  t1Validation: {
    select: {
      id: true, quantityAt20C: true, exportingCountry: true,
      nomination: {
        select: {
          id: true, destination: true, expectedLoadingDate: true,
          driverVehicle: {
            select: {
              driver: { select: { id: true, names: true } },
              vechile: {
                select: {
                  id: true, platNumber: true, truckNumber: true, trailerNumber: true,
                  transport: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CentralStockSelect;

type Trip = Prisma.CentralStockGetPayload<{ select: typeof tripSelect }>;

/**
 * What each transporter's trips lost or gained between the border and the
 * depot.
 *
 * A trip is one T1 validation received into central stock: the quantity the
 * T1 cleared against the quantity taken in, **both at 20 °C**, so temperature
 * is out of the comparison. The difference belongs to whoever carried it —
 * the receipt leads back through the T1 to the nomination, its truck and that
 * truck's transporter — which is what lets a loss be discussed with the firm
 * responsible rather than written off.
 *
 * Every figure is worked out by the same rule the receipt itself used, so the
 * report and the record can never disagree. `toleranceRate` on the receipt is
 * the allowance **as it stood that day**; a product's rate changed since does
 * not re-judge a trip already made.
 */
export class TransporterToleranceService {
  constructor(private db: PrismaClient) {}

  private where(query: TransporterToleranceReportSchema): Prisma.CentralStockWhereInput {
    const vehicle = {
      ...(query.transporterId ? { transporterId: query.transporterId } : {}),
      ...(query.vehicleId ? { id: query.vehicleId } : {}),
    };
    return {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.deportId ? { deportId: query.deportId } : {}),
      ...(query.startDate || query.endDate
        ? { createdAt: { gte: query.startDate, lte: query.endDate } }
        : {}),
      ...(Object.keys(vehicle).length
        ? { t1Validation: { nomination: { driverVehicle: { vechile: vehicle } } } }
        : {}),
    };
  }

  /** One trip's figures, judged by the allowance it carried that day. */
  private present(trip: Trip) {
    const vehicle = trip.t1Validation.nomination.driverVehicle.vechile;
    const driver = trip.t1Validation.nomination.driverVehicle.driver;
    const tolerance = toleranceFor({
      t1Quantity: trip.t1Validation.quantityAt20C,
      receivedQuantity: trip.quantityAt20C,
      // The snapshot on the receipt, not the product's rate today.
      allowedRate: trip.toleranceRate,
    });
    return {
      id: trip.id,
      receiptNumber: trip.receiptNumber,
      receivedAt: trip.createdAt,
      status: trip.status,
      item: trip.item,
      deport: trip.deport,
      t1: {
        id: trip.t1Validation.id,
        exportingCountry: trip.t1Validation.exportingCountry,
        /** What the T1 cleared, at 20 °C. */
        quantityAt20C: money(trip.t1Validation.quantityAt20C),
      },
      nomination: {
        id: trip.t1Validation.nomination.id,
        destination: trip.t1Validation.nomination.destination,
        expectedLoadingDate: trip.t1Validation.nomination.expectedLoadingDate,
      },
      transporter: vehicle.transport,
      vehicle: { id: vehicle.id, platNumber: vehicle.platNumber,
        truckNumber: vehicle.truckNumber, trailerNumber: vehicle.trailerNumber },
      driver,
      /** What was taken in, at 20 °C — and at ambient, for the paperwork. */
      receivedAt20C: money(trip.quantityAt20C),
      receivedAmbient: money(trip.ambQuantity),
      difference: money(tolerance.difference),
      lossQty: money(tolerance.lossQty),
      gainQty: money(tolerance.gainQty),
      rate: money(tolerance.rate),
      allowedRate: tolerance.allowedRate === null ? null : money(tolerance.allowedRate),
      allowedQuantity: tolerance.allowedQuantity === null ? null : money(tolerance.allowedQuantity),
      /** `null` when the product carried no allowance: unjudged, not passed. */
      withinTolerance: tolerance.withinTolerance,
    };
  }

  /**
   * The report: a line per transporter over everything the filters match, and
   * a page of the trips behind them.
   *
   * The totals are counted over every trip, not the page, so narrowing the
   * page never moves them. They are summed from each trip's own figures rather
   * than from the stored columns, which is why a receipt whose allowance was
   * never set still counts its litres while standing outside the judgement.
   */
  async report(query: TransporterToleranceReportSchema) {
    const where = this.where(query);
    // Every matching trip, for the totals; then the page, for the table. The
    // first is a thin read of figures, the second the full picture.
    const [all, page, total] = await Promise.all([
      this.db.centralStock.findMany({ where, select: tripSelect, orderBy: { createdAt: "desc" } }),
      this.db.centralStock.findMany({
        where, ...paginationArgs(query), orderBy: { createdAt: "desc" }, select: tripSelect,
      }),
      this.db.centralStock.count({ where }),
    ]);

    const trips = all.map((trip) => this.present(trip));
    const judged = query.overTolerance === undefined
      ? trips
      : trips.filter((trip) => (query.overTolerance ? trip.withinTolerance === false : trip.withinTolerance === true));

    type Line = {
      transporter: { id: string; name: string };
      trips: number; carried: number; received: number;
      lossQty: number; gainQty: number; difference: number;
      overTolerance: number; unjudged: number;
      /** The net difference as a share of everything they carried. */
      rate: number;
    };
    const byTransporter = new Map<string, Line>();
    for (const trip of judged) {
      const line = byTransporter.get(trip.transporter.id) ?? {
        transporter: trip.transporter,
        trips: 0, carried: 0, received: 0, lossQty: 0, gainQty: 0, difference: 0,
        overTolerance: 0, unjudged: 0, rate: 0,
      };
      line.trips += 1;
      line.carried += trip.t1.quantityAt20C;
      line.received += trip.receivedAt20C;
      line.lossQty += trip.lossQty;
      line.gainQty += trip.gainQty;
      line.difference += trip.difference;
      if (trip.withinTolerance === false) line.overTolerance += 1;
      if (trip.withinTolerance === null) line.unjudged += 1;
      byTransporter.set(trip.transporter.id, line);
    }
    for (const line of byTransporter.values()) {
      line.carried = Number(line.carried.toFixed(2));
      line.received = Number(line.received.toFixed(2));
      line.lossQty = Number(line.lossQty.toFixed(2));
      line.gainQty = Number(line.gainQty.toFixed(2));
      line.difference = Number(line.difference.toFixed(2));
      line.rate = line.carried === 0 ? 0 : Number(((line.difference / line.carried) * 100).toFixed(2));
    }

    const totals = judged.reduce((sum, trip) => ({
      trips: sum.trips + 1,
      carried: sum.carried + trip.t1.quantityAt20C,
      received: sum.received + trip.receivedAt20C,
      lossQty: sum.lossQty + trip.lossQty,
      gainQty: sum.gainQty + trip.gainQty,
      difference: sum.difference + trip.difference,
      overTolerance: sum.overTolerance + (trip.withinTolerance === false ? 1 : 0),
      unjudged: sum.unjudged + (trip.withinTolerance === null ? 1 : 0),
    }), { trips: 0, carried: 0, received: 0, lossQty: 0, gainQty: 0, difference: 0, overTolerance: 0, unjudged: 0 });

    const shown = query.overTolerance === undefined
      ? page.map((trip) => this.present(trip))
      : judged.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    return {
      totals: {
        ...totals,
        carried: Number(totals.carried.toFixed(2)),
        received: Number(totals.received.toFixed(2)),
        lossQty: Number(totals.lossQty.toFixed(2)),
        gainQty: Number(totals.gainQty.toFixed(2)),
        difference: Number(totals.difference.toFixed(2)),
        rate: totals.carried === 0 ? 0 : Number(((totals.difference / totals.carried) * 100).toFixed(2)),
      },
      byTransporter: [...byTransporter.values()].sort((a, b) => b.lossQty - a.lossQty),
      ...paginatedData(shown, query.overTolerance === undefined ? total : judged.length, query),
    };
  }
}
