import type { AppConfig } from "../../config/env.js";
import { AuthUser } from "../../shared/auth/context-user.js";
import { SiteRepository } from "./sites.repository.js";
import { CreateSiteSchema } from "./sites.schema.js";
export class SitesService {
  constructor(private repo: SiteRepository, private config: AppConfig) {}

  async list(actor: AuthUser) {
    return await this.repo.list(actor);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateSiteSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateSiteSchema) {
    return await this.repo.update(id, input);
  }


  async updateStatus (id: string) {
    return await this.repo.changeStatus(id);
  }

}