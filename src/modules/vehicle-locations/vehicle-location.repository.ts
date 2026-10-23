import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { BusinessError, NotFoundError } from "../../utils/errors.js";
import { furthestStage } from "../nominations/nomination-stage.js";
import type {
  AssignVehicleLocationSchema,
  VehicleLocationListQuery,
} from "./vehicle-location.schema.js";

type Tx = Prisma.TransactionClient;

/** The stage a vehicle must have reached before it can be sent to a parking. */
const IN_TRANSIT = "inTransit";

const locationSelect = {
  id: true,
  status: true,
  arrivedAt: true,
  releasedAt: true,
  createdAt: true,
  parking: { select: { id: true, name: true, location: true, status: true } },
  driverVehicle: {
    select: {
      id: true,
      driver: { select: { id: true, names: true, phone: true } },
      vechile: { select: { id: true, platNumber: true, truckNumber: true, trailerNumber: true } },
    },
  },
  nomination: {
    select: {
      id: true,
      destination: true,
      ambQuantity: true,
      expectedLoadingDate: true,
      nominationVessels: {
        select: { stock: { select: { item: { select: { id: true, name: true } } } } },
      },
    },
  },
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.VehicleLocationSelect;

export class VehicleLocationRepository {
  constructor(private db: PrismaClient) {}

  /** One page of where vehicles have stood, with the total behind it. */
  async list(query: VehicleLocationListQuery) {
    const { startDate, endDate, parkingId, nominationId, status, pending, search } = query;
    const where: Prisma.VehicleLocationWhereInput = {
      ...(startDate || endDate
        ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
      ...(parkingId ? { parkingId } : {}),
      ...(nominationId ? { nominationId } : {}),
      ...(status ? { status } : {}),
      // On its way: sent to a parking it has not reached.
      ...(pending ? { arrivedAt: null, status: "active" as const } : {}),
      ...(search
        ? {
            OR: [
              { driverVehicle: { vechile: { platNumber: { contains: search } } } },
              { driverVehicle: { vechile: { truckNumber: { contains: search } } } },
              { driverVehicle: { driver: { names: { contains: search } } } },
              { parking: { name: { contains: search } } },
            ],
          }
        : {}),
    };
    return this.db.$transaction([
      this.db.vehicleLocation.findMany({
        where,
        ...paginationArgs(query),
        orderBy: { createdAt: "desc" },
        select: locationSelect,
      }),
      this.db.vehicleLocation.count({ where }),
    ]);
  }

  /** Where this vehicle is standing now, if anywhere. */
  activeForNomination(nominationId: string) {
    return this.db.vehicleLocation.findFirst({
      where: { nominationId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: locationSelect,
    });
  }

  /** Every parking this trip has stood in, oldest first. */
  historyForNomination(nominationId: string) {
    return this.db.vehicleLocation.findMany({
      where: { nominationId },
      orderBy: { createdAt: "asc" },
      select: locationSelect,
    });
  }

  /**
   * Sends the nomination's vehicle to a parking.
   *
   * All or nothing, because two things must stay true together: a vehicle
   * stands in one place at a time, and that place is one of the parkings on
   * this trip. So the trip must be in transit, the parking must be open, and
   * the vehicle's previous parking is released in the same write — MySQL has no
   * partial unique index, so "one active row per vehicle" lives here.
   *
   * Being parked does not end the transit: a vehicle moves from parking to
   * parking until it is offloaded, and the nomination stays `inTransit`.
   */
  assign(input: AssignVehicleLocationSchema, userId: string) {
    return this.db.$transaction(async (tx) => {
      const nomination = await tx.nomination.findUnique({
        where: { id: input.nominationId },
        select: { id: true, driverVehicleId: true },
      });
      if (!nomination) throw new NotFoundError("Nomination");

      const stage = await furthestStage(tx, input.nominationId);
      if (stage?.status !== IN_TRANSIT) {
        throw new BusinessError(
          "NOMINATION_NOT_IN_TRANSIT",
          stage
            ? `This nomination is at "${stage.status}". A vehicle can only be parked once the trip is marked in transit.`
            : "This nomination has not started yet, so its vehicle cannot be parked.",
        );
      }

      const parking = await tx.parking.findUnique({
        where: { id: input.parkingId },
        select: { id: true, name: true, status: true },
      });
      if (!parking) throw new NotFoundError("Parking");
      if (parking.status !== "active") {
        throw new BusinessError("PARKING_INACTIVE", `${parking.name} is not in use`);
      }

      // The same truck may be on another trip's pairing, so the previous
      // parking is found by the vehicle rather than by this pairing.
      const vehicle = await tx.driverVehicles.findUniqueOrThrow({
        where: { id: nomination.driverVehicleId },
        select: { vehicleId: true },
      });
      await tx.vehicleLocation.updateMany({
        where: { status: "active", driverVehicle: { vehicleId: vehicle.vehicleId } },
        data: { status: "inactive", releasedAt: new Date() },
      });

      return tx.vehicleLocation.create({
        data: {
          parkingId: parking.id,
          driverVehicleId: nomination.driverVehicleId,
          nominationId: nomination.id,
          arrivedAt: input.arrivedAt ?? null,
          assignedBy: userId,
        },
        select: locationSelect,
      });
    });
  }

  /** Records that the vehicle reached the parking it was sent to. */
  async markArrived(id: string, arrivedAt: Date) {
    const { count } = await this.db.vehicleLocation.updateMany({
      where: { id, status: "active", arrivedAt: null },
      data: { arrivedAt },
    });
    if (count !== 1) {
      const current = await this.db.vehicleLocation.findUnique({
        where: { id },
        select: { arrivedAt: true, status: true },
      });
      if (!current) throw new NotFoundError("Vehicle location");
      throw new BusinessError(
        "ALREADY_ARRIVED",
        current.arrivedAt
          ? "This vehicle is already recorded as having arrived"
          : "This parking has been released, so an arrival cannot be recorded against it",
      );
    }
    return this.db.vehicleLocation.findUniqueOrThrow({ where: { id }, select: locationSelect });
  }
}


/**
 * Releases whatever parking this trip's vehicle is standing in. Called when the
 * stock arrives: the trip is over, so the vehicle is no longer held anywhere.
 * Returns how many rows were released, which is 0 when it was never parked.
 */
export async function releaseParkingForNomination(tx: Tx, nominationId: string) {
  const { count } = await tx.vehicleLocation.updateMany({
    where: { nominationId, status: "active" },
    data: { status: "inactive", releasedAt: new Date() },
  });
  return count;
}
