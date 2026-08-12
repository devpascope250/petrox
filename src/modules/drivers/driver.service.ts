import type { AppConfig } from "../../config/env.js";
import { CreateDriverSchema } from "./deriver.schema.js";
import { DriverRepository } from "./driver.repository.js";
export class DriverService {
  constructor(private repo: DriverRepository, private config: AppConfig) {
  }

  async list() {
    return await this.repo.list();
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