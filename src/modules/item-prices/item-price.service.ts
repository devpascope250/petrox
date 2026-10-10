import { ItemPriceRepository } from "./item-price.repository.js";
import type { CreateItemPrice, UpdateItemPrice } from "./item-price.schema.js";

export class ItemPriceService {
  constructor(private repo: ItemPriceRepository) {}

  list() { return this.repo.list(); }

  find(id: string) { return this.repo.find(id); }

  options() { return this.repo.options(); }

  create(input: CreateItemPrice, userId: string) { return this.repo.create(input, userId); }

  update(id: string, input: UpdateItemPrice) { return this.repo.update(id, input); }

  changeStatus(id: string) { return this.repo.changeStatus(id); }
}
