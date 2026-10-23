import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { NotFoundError } from "../../utils/errors.js";
import type { CreateParkingSchema, ParkingListQuery } from "./parking.schema.js";

const parkingSelect = {
  id: true,
  name: true,
  location: true,
  status: true,
  createdAt: true,
  /** How many vehicles are standing here now — what the list is read for. */
  _count: { select: { vehicleLocations: { where: { status: "active" } } } },
} satisfies Prisma.ParkingSelect;

export class ParkingRepository {
  constructor(private db: PrismaClient) {}

  /** One page of the parkings, with the total behind it. */
  async list(query: ParkingListQuery) {
    const { startDate, endDate, status, search } = query;
    const where: Prisma.ParkingWhereInput = {
      ...(startDate || endDate
        ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } }
        : {}),
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [{ name: { contains: search } }, { location: { contains: search } }] }
        : {}),
    };
    return this.db.$transaction([
      this.db.parking.findMany({
        where,
        ...paginationArgs(query),
        orderBy: [{ status: "asc" }, { name: "asc" }],
        select: parkingSelect,
      }),
      this.db.parking.count({ where }),
    ]);
  }

  /** Every parking a vehicle may be sent to, for a picker. */
  active() {
    return this.db.parking.findMany({
      where: { status: "active" },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, location: true },
    });
  }

  find(id: string) {
    return this.db.parking.findUnique({ where: { id }, select: parkingSelect });
  }

  create(data: CreateParkingSchema) {
    return this.db.parking.create({
      data: { name: data.name, location: data.location, status: data.status ?? "active" },
      select: parkingSelect,
    });
  }

  async update(id: string, data: CreateParkingSchema) {
    if (!(await this.find(id))) throw new NotFoundError("Parking");
    return this.db.parking.update({ where: { id }, data, select: parkingSelect });
  }

  /** Flips active to inactive and back; an inactive parking takes no vehicles. */
  async changeStatus(id: string) {
    const parking = await this.find(id);
    if (!parking) throw new NotFoundError("Parking");
    return this.db.parking.update({
      where: { id },
      data: { status: parking.status === "active" ? "inactive" : "active" },
      select: parkingSelect,
    });
  }
}
