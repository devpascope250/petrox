import type { PrismaClient } from "../../../../prisma/generated/prisma/client.js";
import { BusinessError, NotFoundError } from "../../../utils/errors.js";
import { CreateTaxDescriptionSchema } from "./tax.schema.js";

export class TaxDescriptionRepository {
  constructor(private db: PrismaClient) {}

  list() {
    return this.db.taxDescription.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, description: true, status: true, createdAt: true,
        _count: { select: { taxClearances: true } },
      },
    });
  }

  /** The codes a clearance may be charged under: the retired ones are not offered. */
  active() {
    return this.db.taxDescription.findMany({
      where: { status: "active" },
      orderBy: { code: "asc" },
      select: { id: true, code: true, description: true },
    });
  }

  find(id: string) {
    return this.db.taxDescription.findUnique({ where: { id } });
  }

  async create(data: CreateTaxDescriptionSchema) {
    await this.assertCodeFree(data.code);
    return this.db.taxDescription.create({
      data: { code: data.code, description: data.description ?? null },
    });
  }

  async update(id: string, data: CreateTaxDescriptionSchema) {
    if (!(await this.find(id))) throw new NotFoundError("Tax not found");
    await this.assertCodeFree(data.code, id);
    return this.db.taxDescription.update({
      where: { id },
      data: { code: data.code, description: data.description ?? null },
    });
  }

  async changeStatus(id: string) {
    const tax = await this.find(id);
    if (!tax) throw new NotFoundError("Tax not found");
    return this.db.taxDescription.update({
      where: { id },
      data: { status: tax.status === "active" ? "inactive" : "active" },
    });
  }

  /**
   * Deleting is only for a code nobody was ever charged under. Once it has
   * been charged it is part of what a clearance was assessed on, so it is
   * retired instead — and the charge keeps its own copy of the code anyway.
   */
  async delete(id: string) {
    const tax = await this.db.taxDescription.findUnique({
      where: { id }, select: { _count: { select: { taxClearances: true } } },
    });
    if (!tax) throw new NotFoundError("Tax not found");
    if (tax._count.taxClearances > 0) {
      throw new BusinessError("400", "A tax already charged on a clearance cannot be deleted; deactivate it instead");
    }
    return this.db.taxDescription.delete({ where: { id } });
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const existing = await this.db.taxDescription.findUnique({ where: { code }, select: { id: true } });
    if (existing && existing.id !== exceptId) {
      throw new BusinessError("400", `A tax with the code ${code} already exists`);
    }
  }
}
