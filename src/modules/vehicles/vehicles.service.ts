import type { AppConfig } from "../../config/env.js";
import { VehicleRepository } from "./vehicles.repository.js";
import { CreateVehicleSchema } from "./vehicles.schema.js";
export class VehiclesService {
  constructor(private repo: VehicleRepository, private config: AppConfig) {}

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateVehicleSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateVehicleSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}