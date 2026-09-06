import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import type { CreateCargoInvoiceInput, UpdateCargoInvoiceInput } from "./cargo-invoice.schema.js";

const cargoInvoiceInclude = { cargo: true } as const;

export class CargoInvoiceRepository {
  constructor(private db: PrismaClient) {}

  list(cargoId: string) {
    return this.db.cargoInvoice.findMany({
      where: {
        cargoId
      },
      orderBy: { createdAt: "desc" },
      include: cargoInvoiceInclude,
    });
  }

  find(id: string) {
    return this.db.cargoInvoice.findUnique({
      where: { id },
      include: cargoInvoiceInclude,
    });
  }

  create(data: CreateCargoInvoiceInput) {
    return this.db.cargoInvoice.create({ data, include: cargoInvoiceInclude });
  }

  update(id: string, data: UpdateCargoInvoiceInput) {
    return this.db.cargoInvoice.update({ where: { id }, data, include: cargoInvoiceInclude });
  }

  delete(id: string) {
    return this.db.cargoInvoice.delete({ where: { id }, include: cargoInvoiceInclude });
  }

  findCargo(id: string) {
    return this.db.cargo.findUnique({ where: { id }, select: { id: true } });
  }
}
