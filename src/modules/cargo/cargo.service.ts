import { CargoStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { CargoRepository } from "./cargo.repository.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { CargoListQuery } from "./cargo.schema.js";
import { CreateCargoSchema, FileSchema } from "./cargo.schema.js";
export class CargoService {
  constructor(private repo: CargoRepository, private config: AppConfig) {
  }

  async list(query: CargoListQuery) {
    const [cargos, total] = await this.repo.list(query);
    const items = cargos.map((al) => {
      return  {
        ...al,
        supportingDocUrl: `${this.config.APP_URL}${al.supportingDocUrl}`
      }
    });
    return paginatedData(items, total, query);
  }

  async find(id: string) { 
    const cargo = await this.repo.find(id);
    return {
      ...cargo,
      supportingDocUrl: `${this.config.APP_URL}${cargo?.supportingDocUrl}`
    }; 
  }

  async create(input: CreateCargoSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateCargoSchema) {
    return await this.repo.update(id, input);
  }

  async updateStatus (id: string, status: CargoStatus, receivedDate: Date) {
    return await this.repo.changeStatus(id, status, receivedDate);
  }

}