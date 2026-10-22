import type { AppConfig } from "../../config/env.js";
import { documentUrl } from "../../utils/static-url.js";
import { NotFoundError } from "../../utils/errors.js";
import { CargoInvoiceRepository } from "./cargo-invoice.repository.js";
import type { CreateCargoInvoiceInput, UpdateCargoInvoiceInput } from "./cargo-invoice.schema.js";

export class CargoInvoiceService {
  constructor(private repo: CargoInvoiceRepository, private config: AppConfig) {}

  async list(cargoId:  string) {
    return (await this.repo.list(cargoId)).map((invoice) => this.withDocumentUrl(invoice));
  }

  async find(id: string) {
    const invoice = await this.repo.find(id);
    if (!invoice) throw new NotFoundError("Cargo invoice");
    return this.withDocumentUrl(invoice);
  }

  async create(input: CreateCargoInvoiceInput) {
    await this.ensureCargo(input.cargoId);
    return this.withDocumentUrl(await this.repo.create(input));
  }

  async update(id: string, input: UpdateCargoInvoiceInput) {
    await this.find(id);
    if (input.cargoId) await this.ensureCargo(input.cargoId);
    return this.withDocumentUrl(await this.repo.update(id, input));
  }

  async delete(id: string) {
    await this.find(id);
    return this.withDocumentUrl(await this.repo.delete(id));
  }

  private async ensureCargo(id: string) {
    if (!(await this.repo.findCargo(id))) throw new NotFoundError("Cargo");
  }

  private withDocumentUrl<T extends { supportingDocUrl: string | null }>(invoice: T): T {
    // `STATIC_URL` is the public address uploads are served at, so the document
    // opens from the web app's own origin too — see `documentUrl`.
    return { ...invoice, supportingDocUrl: documentUrl(this.config, invoice.supportingDocUrl) };
  }
}
