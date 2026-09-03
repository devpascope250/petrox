import type { AppConfig } from "../../config/env.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { CreateDriverSchema } from "./deriver.schema.js";
import { DriverRepository } from "./driver.repository.js";
export class DriverService {
  constructor(private repo: DriverRepository, private config: AppConfig) {
  }

  async list(query: PaginationQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateDriverSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateDriverSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

  async assignVehicle(vehicleId: string, driverId: string) {
    return await this.repo.assignVehicles(vehicleId, driverId)
  }

}
