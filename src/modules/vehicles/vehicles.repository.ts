import type { Prisma, PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { CreateVehicleSchema, VehicleListQuery } from "./vehicles.schema.js";

/** How a rig is named wherever one is written out: `RAB123F/TR-884`. */
export const rigName = (platNumber: string, trailerNumber: string) =>
  `${platNumber}/${trailerNumber}`;
export class VehicleRepository {
  constructor(private db: PrismaClient) {}

  /**
   * Every truck, newest first — narrowed by one search term.
   *
   * The term is matched against the plate, the trailer, the body number, the
   * model and the transporter, and against the **pair** as it is written:
   * `RAB123F/TR-884`. Now that one plate may appear on two rigs, the pair is
   * the only name that identifies one, so it has to be the thing people can
   * type.
   */
  async list(query: VehicleListQuery = {}) {
    const term = query.search?.trim();
    /*
     * Split on the slash, so a pair matches both halves rather than being
     * looked for verbatim in one column — `RAB123F/TR-884` is a plate AND a
     * trailer, and neither field holds the slash.
     */
    const [plate, trailer] = term?.includes("/")
      ? term.split("/", 2).map((part: string) => part.trim())
      : [undefined, undefined];
    const where: Prisma.VehicleWhereInput | undefined = !term
      ? undefined
      : plate && trailer
        ? { platNumber: { contains: plate }, trailerNumber: { contains: trailer } }
        : {
            OR: [
              { platNumber: { contains: term } },
              { trailerNumber: { contains: term } },
              { truckNumber: { contains: term } },
              { model: { contains: term } },
              { transport: { is: { name: { contains: term } } } },
            ],
          };
    return await this.db.vehicle.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        platNumber: true,
        model: true,
        status: true,
        tankCapacity: true,
        truckNumber: true,
        trailerNumber: true,
        transporterId: true,
        transport: {
          select: {
            id: true,
            name: true,
            address: true
          }
        }
      },
    });
  }

  /**
   * Refuses a rig already on record.
   *
   * The database holds the same rule, so this is about the message rather than
   * the guarantee: a bare `P2002` names a constraint, not the truck somebody
   * has just typed in twice. `exclude` drops the row being edited, so saving a
   * truck unchanged is not refused by itself.
   */
  private async assertRigFree(data: CreateVehicleSchema, exclude?: string) {
    const existing = await this.db.vehicle.findFirst({
      where: {
        platNumber: data.platNumber,
        trailerNumber: data.trailerNumber,
        ...(exclude ? { NOT: { id: exclude } } : {}),
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("VEHICLE_EXISTS",
        `${rigName(data.platNumber, data.trailerNumber)} is already on record. `
        + "The same plate may be recorded again only with a different trailer.");
    }
  }

  async create(data: CreateVehicleSchema) {
    await this.assertRigFree(data);
    return this.db.vehicle.create({
      data: {
        model: data.model,
        platNumber: data.platNumber,
        tankCapacity: data.tankCapacity,
        trailerNumber: data.trailerNumber,
        truckNumber: data.truckNumber,
        transporterId: data.transporterId,
        status: "active",
      },
    });
  }

  async update(id: string, data: CreateVehicleSchema) {
    if (!(await this.find(id))) throw new NotFoundError();
    await this.assertRigFree(data, id);
    return await this.db.vehicle.update({
      where: { id: id },
      data: {
        ...data
      },
    });
  }

  async changeStatus(id: string) {
    const veh = await this.find(id);
    if (!veh) throw new NotFoundError();
    return await this.db.vehicle.update({
      where: { id },
      data: { status: veh.status === "active" ? "inactive" : "active" },
    });
  }

  find(id: string) {
    return this.db.vehicle.findUnique({ where: { id } });
  }
}
