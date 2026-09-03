import type { AppConfig } from "../../config/env.js";
import type { CreateBuikLocationSchema, CreateLocationSchema } from "./location.schema.js";
import { LocationRepository } from "./location.repository.js";

export class LocationService {
  constructor(private repo: LocationRepository, private config: AppConfig) {}

  list() {
    return this.repo.list();
  }

  find(id: string) {
    return this.repo.find(id);
  }

  findByParent(parentId: string) {
    return this.repo.findByParent(parentId);
  }

  create(input: CreateLocationSchema) {
    return this.repo.create(input);
  }

    createBuilk(input: CreateBuikLocationSchema) {
    return this.repo.createBuilk(input);
  }
}
