import type { AppConfig } from "../../config/env.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { documentUrl as publicDocumentUrl } from "../../utils/static-url.js";
import { SupplerRepository } from "./supplier.repository.js";
import { CreateSupplierSchema, CreateSupplierTypeSchema } from "./supplier.schema.js";

export class SupplierService {
  constructor(private repo: SupplerRepository, private config: AppConfig) {}

  async list(query: PaginationQuery) {
    return (await this.repo.list(query)).map((supplier) => this.withDocumentUrl(supplier));
  }

  async find(id: string) {
    const supplier = await this.repo.find(id);
    return supplier && this.withDocumentUrl(supplier);
  }

  /**
   * The document as an address a browser can open, rather than the `/uploads/…`
   * path it is stored as — the web app is served from another origin in
   * development, and the POS from another device altogether, so a bare path
   * resolves against the wrong host.
   */
  private withDocumentUrl<T extends { documentUrl: string | null }>(supplier: T) {
    return { ...supplier, documentUrl: publicDocumentUrl(this.config, supplier.documentUrl) };
  }

  async create(input: CreateSupplierSchema) {
    return this.withDocumentUrl(await this.repo.create(input));
  }

  async update(id: string, input: CreateSupplierSchema) {
    return this.withDocumentUrl(await this.repo.update(id, input));
  }


  async listSupplierType(query: PaginationQuery) {
    const [items, total] = await this.repo.listSupplierType(query);
    return paginatedData(items, total, query);
  }

  findSupplierType(id: string){
    return this.repo.findSupplierType(id);
  }

  async updateSupplierType(id: string, input: CreateSupplierTypeSchema) {
    return await this.repo.updateSupplierType(id, input)
  }

  async createSupplierType(data: CreateSupplierTypeSchema) {
    return await this.repo.createSupplierType(data);
  }

  async updateSupplierStatus (id: string) {
    return await this.repo.changeSupplierStatus(id);
  }

  async updateSupplierTypeStatus (id: string) {
    return await this.repo.changeSupplierTypeStatus(id);
  }
}
