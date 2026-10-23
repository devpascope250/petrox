import { describe, expect, it, vi } from "vitest";
import {
  releaseParkingForNomination,
  VehicleLocationRepository,
} from "../src/modules/vehicle-locations/vehicle-location.repository.js";
import {
  assignVehicleLocationSchema,
  vehicleLocationListQuerySchema,
} from "../src/modules/vehicle-locations/vehicle-location.schema.js";
import { parkingListQuerySchema } from "../src/modules/parkings/parking.schema.js";

const NOMINATION = "00000000-0000-4000-8000-000000000001";
const PARKING = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";

/**
 * A database for the assignment, with the stage the trip has reached and the
 * parking's status as the two things the rules turn on.
 */
function assignDb({
  stage = "inTransit",
  parkingStatus = "active" as string | null,
  standingAt = null as string | null,
} = {}) {
  const tx = {
    nomination: { findUnique: vi.fn().mockResolvedValue({ id: NOMINATION, driverVehicleId: "pair-1" }) },
    nominationTimeLine: {
      findFirst: vi.fn().mockResolvedValue(stage ? { timeLineStatus: { status: stage, level: 5 } } : null),
    },
    parking: {
      findUnique: vi.fn().mockResolvedValue(
        parkingStatus ? { id: PARKING, name: "Yard A", status: parkingStatus } : null,
      ),
    },
    driverVehicles: { findUniqueOrThrow: vi.fn().mockResolvedValue({ vehicleId: "truck-1" }) },
    vehicleLocation: {
      // Where the vehicle stands now, which decides whether anything changes.
      findFirst: vi.fn().mockResolvedValue(
        standingAt ? { id: "loc-0", parkingId: standingAt } : null,
      ),
      findUniqueOrThrow: vi.fn(({ where }: any) => ({ id: where.id, parking: { id: standingAt } })),
      update: vi.fn((args: any) => args.data),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn((args: any) => ({ id: "loc-1", ...args.data })),
    },
  };
  return { tx, db: { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)) } };
}

const assign = (db: unknown, input = { nominationId: NOMINATION, parkingId: PARKING }) =>
  new VehicleLocationRepository(db as never).assign(input, USER);

describe("sending a vehicle to a parking", () => {
  it("records it against the trip, and releases wherever that vehicle stood before", async () => {
    const { db, tx } = assignDb({ standingAt: "another-parking" });
    const created: any = await assign(db);

    // The previous parking is found by the *vehicle*, not by this pairing: the
    // same truck may be paired with another driver.
    expect(tx.vehicleLocation.updateMany).toHaveBeenCalledWith({
      where: { status: "active", driverVehicle: { vehicleId: "truck-1" } },
      data: { status: "inactive", releasedAt: expect.any(Date) },
    });
    expect(created).toMatchObject({
      parkingId: PARKING,
      nominationId: NOMINATION,
      driverVehicleId: "pair-1",
      assignedBy: USER,
      // Sent, not yet arrived.
      arrivedAt: null,
    });
  });

  it("refuses a trip that is not in transit, and says where it is instead", async () => {
    for (const stage of ["t1Confirmed", "t1Pending", "stockReceived"]) {
      const { db, tx } = assignDb({ stage });
      await expect(assign(db)).rejects.toMatchObject({ code: "NOMINATION_NOT_IN_TRANSIT" });
      expect(tx.vehicleLocation.create).not.toHaveBeenCalled();
    }
    // A trip with no progress at all is refused too, with its own wording.
    const { db } = assignDb({ stage: "" });
    await expect(assign(db)).rejects.toMatchObject({ code: "NOMINATION_NOT_IN_TRANSIT" });
  });

  it("refuses a parking that is out of use, or one that does not exist", async () => {
    await expect(assign(assignDb({ parkingStatus: "inactive" }).db)).rejects.toMatchObject({
      code: "PARKING_INACTIVE",
    });
    await expect(assign(assignDb({ parkingStatus: null }).db)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("takes the arrival time when the vehicle is already standing there", () => {
    const parsed = assignVehicleLocationSchema.parse({
      nominationId: NOMINATION,
      parkingId: PARKING,
      arrivedAt: "2026-10-23T08:00:00.000Z",
    });
    expect(parsed.arrivedAt).toEqual(new Date("2026-10-23T08:00:00.000Z"));
    // The vehicle is never named: it is the one on the trip.
    expect(assignVehicleLocationSchema.safeParse({ nominationId: NOMINATION }).success).toBe(false);
  });
});

describe("receiving the stock", () => {
  it("releases whatever parking the trip's vehicle was standing in", async () => {
    const tx = { vehicleLocation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    expect(await releaseParkingForNomination(tx as never, NOMINATION)).toBe(1);
    expect(tx.vehicleLocation.updateMany).toHaveBeenCalledWith({
      where: { nominationId: NOMINATION, status: "active" },
      data: { status: "inactive", releasedAt: expect.any(Date) },
    });
  });

  it("is happy when the vehicle was never parked", async () => {
    const tx = { vehicleLocation: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    expect(await releaseParkingForNomination(tx as never, NOMINATION)).toBe(0);
  });
});

describe("the lists behind the two pages", () => {
  it("page a window, and default to the first page of twenty", () => {
    expect(parkingListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(vehicleLocationListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(
      vehicleLocationListQuerySchema.parse({ startDate: "2026-10-01", pending: "true" }),
    ).toMatchObject({ startDate: new Date("2026-10-01"), pending: true });
    // "pending" is a string on a query, like every other flag.
    expect(vehicleLocationListQuerySchema.parse({ pending: "false" }).pending).toBe(false);
  });

  it("only asks the database for one page of vehicle locations", async () => {
    const calls: any[] = [];
    const model = {
      findMany: vi.fn((args: unknown) => calls.push(args)),
      count: vi.fn((args: unknown) => calls.push(args)),
    };
    const db: any = new Proxy(
      { $transaction: vi.fn(async () => [[], 42]) },
      { get: (target, key) => (key in target ? (target as any)[key] : model) },
    );
    const query = vehicleLocationListQuerySchema.parse({ page: 3, pageSize: 10, parkingId: PARKING });
    const [, total] = await new VehicleLocationRepository(db).list(query);

    expect(model.findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10, where: { parkingId: PARKING } });
    expect((model.count.mock.calls[0][0] as any).where).toEqual((model.findMany.mock.calls[0][0] as any).where);
    expect(total).toBe(42);
  });
});

describe("sending a vehicle where it already stands", () => {
  it("changes nothing: no departure, no second stay, the arrival kept", async () => {
    const { db, tx } = assignDb({ standingAt: PARKING });
    const same: any = await assign(db);

    // Releasing and re-creating would stamp a move that never happened.
    expect(tx.vehicleLocation.updateMany).not.toHaveBeenCalled();
    expect(tx.vehicleLocation.create).not.toHaveBeenCalled();
    expect(tx.vehicleLocation.update).not.toHaveBeenCalled();
    // The stay it is already on comes back, so a caller still learns where it is.
    expect(same.id).toBe("loc-0");
  });

  it("still takes an arrival time for the stay it is already on", async () => {
    const { db, tx } = assignDb({ standingAt: PARKING });
    const arrivedAt = new Date("2026-10-23T09:00:00.000Z");
    await new VehicleLocationRepository(db as never).assign(
      { nominationId: NOMINATION, parkingId: PARKING, arrivedAt },
      USER,
    );
    expect(tx.vehicleLocation.update).toHaveBeenCalledWith({
      where: { id: "loc-0" },
      data: { arrivedAt },
    });
    expect(tx.vehicleLocation.create).not.toHaveBeenCalled();
  });

  it("does move it when the parking is a different one", async () => {
    const { db, tx } = assignDb({ standingAt: "another-parking" });
    await assign(db);
    expect(tx.vehicleLocation.updateMany).toHaveBeenCalledOnce();
    expect(tx.vehicleLocation.create).toHaveBeenCalledOnce();
  });

  it("does not release anything when it was standing nowhere", async () => {
    const { db, tx } = assignDb();
    await assign(db);
    expect(tx.vehicleLocation.updateMany).not.toHaveBeenCalled();
    expect(tx.vehicleLocation.create).toHaveBeenCalledOnce();
  });
});
