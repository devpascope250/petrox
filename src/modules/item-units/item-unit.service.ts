import { ItemUnitRepository } from "./item-unit.repository.js";
import type { CreateItemUnit, UpdateItemUnit } from "./item-unit.schema.js";

export class ItemUnitService {
  constructor(private repo: ItemUnitRepository) {}

  list() { return this.repo.list(); }

  find(id: string) { return this.repo.find(id); }

  options() { return this.repo.options(); }

  create(input: CreateItemUnit) { return this.repo.create(input); }

  update(id: string, input: UpdateItemUnit) { return this.repo.update(id, input); }

  changeStatus(id: string) { return this.repo.changeStatus(id); }
}
