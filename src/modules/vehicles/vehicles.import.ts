import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { importRows, num, text, type SheetImportInput, type SheetImportResult } from "../../shared/import/sheet-import.js";
import { parseInput } from "../../shared/validation/index.js";
import { BusinessError, ConflictError } from "../../utils/errors.js";
import { createVehicleSchema } from "./vehicles.schema.js";
import type { VehicleRepository } from "./vehicles.repository.js";

/**
 * Trucks from the filled-in template.
 *
 * The sheet names the transporter that owns the truck; a name that is not on
 * record stops the row, because a truck under the wrong transporter cannot be
 * nominated by the people who actually run it, and a driver of that
 * transporter may not be assigned to it.
 */
export class VehicleImporter {
  constructor(private db: PrismaClient, private repo: VehicleRepository) {}

  async run(input: SheetImportInput): Promise<SheetImportResult> {
    const transporters = new Map(
      (await this.db.transporter.findMany({ where: { status: "active" }, select: { id: true, name: true } }))
        .map((transporter) => [transporter.name.trim().toLowerCase(), transporter.id]),
    );
    return importRows(input.rows, async (row) => {
      const transporterName = text(row.transporter);
      if (!transporterName) throw new BusinessError("TRANSPORTER_REQUIRED", "Transporter is required");
      const transporterId = transporters.get(transporterName.toLowerCase());
      if (!transporterId) {
        throw new BusinessError("TRANSPORTER_UNKNOWN",
          `Transporter "${transporterName}" does not exist — add it on the Transporters page first`);
      }
      const capacity = num(row.capacity);
      if (capacity === undefined || Number.isNaN(capacity) || capacity <= 0) {
        throw new BusinessError("CAPACITY_INVALID", "Tank capacity must be a number of litres above zero");
      }
      const data = parseInput(createVehicleSchema, {
        platNumber: text(row.plate),
        transporterId,
        truckNumber: text(row.truck),
        trailerNumber: text(row.trailer),
        model: text(row.model),
        tankCapacity: capacity,
      });
      // The plate is what a truck is called everywhere else in the system, so
      // two rows with one plate would make every later choice ambiguous.
      if (await this.db.vehicle.findFirst({ where: { platNumber: data.platNumber }, select: { id: true } })) {
        throw new ConflictError("VEHICLE_EXISTS", `${data.platNumber} is already on record`);
      }
      return this.repo.create(data);
    });
  }
}
