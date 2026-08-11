import type { AppConfig } from "../../config/env.js";
import { SupplerRepository } from "./supplier.repository.js";
import { CreateSupplierSchema, CreateSupplierTypeSchema } from "./supplier.schema.js";

export class SupplierService {
  constructor(private repo: SupplerRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateSupplierSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateSupplierSchema) {
    return await this.repo.update(id, input);
  }


  listSupplierType() {
    return this.repo.listSupplierType();
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