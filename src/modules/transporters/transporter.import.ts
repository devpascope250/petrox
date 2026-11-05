import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { importRows, text, type SheetImportInput, type SheetImportResult } from "../../shared/import/sheet-import.js";
import { parseInput } from "../../shared/validation/index.js";
import { ConflictError } from "../../utils/errors.js";
import { createTransporterSchema } from "./transporter.schema.js";
import type { TransporterRepository } from "./transporter.repository.js";

/**
 * Transporters from the filled-in template. Nothing to look up — a transporter
 * stands on its own — so a row only has to be valid and not already on record.
 */
export class TransporterImporter {
  constructor(private db: PrismaClient, private repo: TransporterRepository) {}

  async run(input: SheetImportInput): Promise<SheetImportResult> {
    return importRows(input.rows, async (row) => {
      const data = parseInput(createTransporterSchema, {
        name: text(row.name),
        phone: text(row.phone),
        email: text(row.email) ?? null,
        address: text(row.address),
        tinNumber: text(row.tin),
      });
      // Not unique in the database; the name is how the same company is
      // recognised, and vehicles and drivers are attached to it by that name.
      if (await this.db.transporter.findFirst({ where: { name: data.name }, select: { id: true } })) {
        throw new ConflictError("TRANSPORTER_EXISTS", `${data.name} is already on record`);
      }
      return this.repo.create(data);
    });
  }
}
