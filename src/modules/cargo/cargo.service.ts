import { CargoStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { CargoRepository } from "./cargo.repository.js";
import { paginatedData } from "../../shared/pagination/index.js";
import { documentUrl } from "../../utils/static-url.js";
import type { CargoListQuery } from "./cargo.schema.js";
import { CreateCargoSchema, FileSchema } from "./cargo.schema.js";
export class CargoService {
  constructor(private repo: CargoRepository, private config: AppConfig) {
  }

  async list(query: CargoListQuery) {
    const [cargos, total] = await this.repo.list(query);
    return paginatedData(cargos.map((cargo) => this.withDocumentUrls(cargo)), total, query);
  }

  async find(id: string) {
    const cargo = await this.repo.find(id);
    return cargo && this.withDocumentUrls(cargo);
  }

  /**
   * Every document on a shipment as an address a browser can open: its own, and
   * those of the PFIs and invoices nested on it.
   *
   * These used to be `APP_URL + path`, which made `"…null"` out of a shipment
   * with no document, and left the nested PFIs and invoices as bare paths that
   * only resolved on the API's own origin.
   */
  private withDocumentUrls<
    T extends {
      supportingDocUrl: string | null;
      pfis?: Array<{ supportingDocUrl: string | null }>;
      cargoInvoices?: Array<{ supportingDocUrl: string | null }>;
    },
  >(cargo: T): T {
    const open = (path: string | null) => documentUrl(this.config, path);
    return {
      ...cargo,
      supportingDocUrl: open(cargo.supportingDocUrl),
      ...(cargo.pfis
        ? { pfis: cargo.pfis.map((pfi) => ({ ...pfi, supportingDocUrl: open(pfi.supportingDocUrl) })) }
        : {}),
      ...(cargo.cargoInvoices
        ? {
            cargoInvoices: cargo.cargoInvoices.map((invoice) => ({
              ...invoice,
              supportingDocUrl: open(invoice.supportingDocUrl),
            })),
          }
        : {}),
    };
  }

  async create(input: CreateCargoSchema) {
    // Resolved on the way out like every other answer, so a client that shows
    // the record it just created has a URL it can open.
    return this.withDocumentUrls(await this.repo.create(input));
  }

  async update(id: string, input: CreateCargoSchema) {
    return this.withDocumentUrls(await this.repo.update(id, input));
  }

  async updateStatus (id: string, status: CargoStatus, receivedDate: Date) {
    return this.withDocumentUrls(await this.repo.changeStatus(id, status, receivedDate));
  }

}