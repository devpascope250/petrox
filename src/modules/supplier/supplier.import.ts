import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { importRows, text, type SheetImportInput, type SheetImportResult } from "../../shared/import/sheet-import.js";
import { parseInput } from "../../shared/validation/index.js";
import { BusinessError, ConflictError } from "../../utils/errors.js";
import { createSupplierSchema } from "./supplier.schema.js";
import type { SupplerRepository } from "./supplier.repository.js";

/**
 * Suppliers from the filled-in template.
 *
 * The sheet names the supplier **type** rather than its id — nobody types a
 * uuid into Excel — so the types are read once and matched by name, and a name
 * that does not exist stops that row rather than quietly creating a supplier
 * with the wrong type. A type is only created on its own page: inventing one
 * from a misspelling is how a list of types ends up with "Fuel" three times.
 */
export class SupplierImporter {
  constructor(private db: PrismaClient, private repo: SupplerRepository) {}

  async run(input: SheetImportInput): Promise<SheetImportResult> {
    const types = new Map(
      (await this.db.supplierType.findMany({ where: { status: "active" }, select: { id: true, type: true } }))
        .map((type) => [type.type.trim().toLowerCase(), type.id]),
    );
    return importRows(input.rows, async (row) => {
      const typeName = text(row.type);
      if (!typeName) throw new BusinessError("SUPPLIER_TYPE_REQUIRED", "Type is required");
      const supplierTypeId = types.get(typeName.toLowerCase());
      if (!supplierTypeId) {
        throw new BusinessError("SUPPLIER_TYPE_UNKNOWN",
          `Type "${typeName}" does not exist — add it on the Supplier types page first`);
      }
      const data = parseInput(createSupplierSchema, {
        name: text(row.name),
        phone: text(row.phone),
        address: text(row.address) ?? null,
        tinNumber: text(row.tin) ?? null,
        supplierTypeId,
      });
      // A supplier is not unique in the database, so the same sheet imported
      // twice would double every row. Matching on the name is what a person
      // reading the list would call the same supplier.
      if (await this.db.supplier.findFirst({ where: { name: data.name }, select: { id: true } })) {
        throw new ConflictError("SUPPLIER_EXISTS", `${data.name} is already on record`);
      }
      return this.repo.create(data);
    });
  }
}
