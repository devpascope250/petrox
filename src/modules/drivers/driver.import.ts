import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { importRows, text, type SheetImportInput, type SheetImportResult } from "../../shared/import/sheet-import.js";
import { parseInput } from "../../shared/validation/index.js";
import { BusinessError, ConflictError } from "../../utils/errors.js";
import { createDriverSchema } from "./deriver.schema.js";
import type { DriverRepository } from "./driver.repository.js";

/**
 * Drivers from the filled-in template, each under the transporter they work
 * for — named in the sheet, matched here, and required: which transporter a
 * driver belongs to is what decides the trucks he may be assigned to.
 */
export class DriverImporter {
  constructor(private db: PrismaClient, private repo: DriverRepository) {}

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
      const data = parseInput(createDriverSchema, {
        names: text(row.names),
        phone: text(row.phone),
        lisence: text(row.licence),
        // The create schema spells it `paassport`; the column does not.
        paassport: text(row.passport),
        transporterId,
      });
      // The licence is the one thing a driver cannot share with another.
      if (await this.db.driver.findFirst({ where: { lisence: data.lisence }, select: { id: true } })) {
        throw new ConflictError("DRIVER_EXISTS", `Licence ${data.lisence} is already on record`);
      }
      return this.repo.create(data);
    });
  }
}
