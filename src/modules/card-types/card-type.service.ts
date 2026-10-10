import { CardTypeRepository } from "./card-type.repository.js";
import type { CreateCardType, UpdateCardType } from "./card-type.schema.js";

export class CardTypeService {
  constructor(private repo: CardTypeRepository) {}

  list() { return this.repo.list(); }

  find(id: string) { return this.repo.find(id); }

  create(input: CreateCardType, userId: string) { return this.repo.create(input, userId); }

  update(id: string, input: UpdateCardType) { return this.repo.update(id, input); }

  changeStatus(id: string) { return this.repo.changeStatus(id); }
}
