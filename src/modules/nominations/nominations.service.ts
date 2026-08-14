import { StockStatus } from "../../../prisma/generated/prisma/enums.js";
import type { AppConfig } from "../../config/env.js";
import { NominationRepository } from "./nominations.repository.js";
import { CreateNominationsSchema } from "./nominations.schema.js";
export class NominationService {
  constructor(private repo: NominationRepository, private config: AppConfig) {
  }

  async list() {
    return await this.repo.list();
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateNominationsSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateNominationsSchema) {
    return await this.repo.update(id, input);
  }

}