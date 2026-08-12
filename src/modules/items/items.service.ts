import type { AppConfig } from "../../config/env.js";
import { buildItemTree } from "./items-tree.js";
import { ItemsRepository } from "./items.repository.js";
import { CreateItemSchema, CreateUnitSchema } from "./items.schema.js";
import { ItemsAccessRow } from "./items.types.js";
export class ItemsService {
  constructor(private repo: ItemsRepository, private config: AppConfig) {}

  async list() {
    const items = await this.repo.list();
    const revisioned: ItemsAccessRow[] = items.map((item) => {
      return {
        id: item.id,
        name: item.name,
        descriptions: item.descriptions ?? "",
        parentId: item.parentId ?? null,
        baseUnitId: item.baseUnitId
      }
    })
    return buildItemTree(revisioned);
  }

  find(id: string) { return this.repo.find(id); }

  async create(input: CreateItemSchema) {
    return this.repo.create(input);
  }

  async update(id: string, input: CreateItemSchema) {
    return await this.repo.update(id, input);
  }

  deleteItem(id: string) {
    return this.repo.deleteItem(id);
  }

  deleteUnit(id: string) {
    return this.repo.deleteUnit(id);
  }

  listUnits() {
    return this.repo.listUnits();
  }

  findUnit(id: string){
    return this.repo.findUnit(id);
  }

  async updateUnit(id: string, input: CreateUnitSchema) {
    return await this.repo.updateUnit(id, input)
  }

  async createUnit(data: CreateUnitSchema) {
    return await this.repo.createUnit(data);
  }

  async updateItemStatus (id: string) {
    return await this.repo.changeItemStatus(id);
  }

  async updateUnitStatus (id: string) {
    return await this.repo.changeUnitStatus(id);
  }
}