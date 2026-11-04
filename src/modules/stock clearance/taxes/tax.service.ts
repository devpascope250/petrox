import { TaxDescriptionRepository } from "./tax.repository.js";
import { CreateTaxDescriptionSchema } from "./tax.schema.js";

export class TaxDescriptionService {
  constructor(private repo: TaxDescriptionRepository) {}

  list() { return this.repo.list(); }
  active() { return this.repo.active(); }
  find(id: string) { return this.repo.find(id); }
  create(input: CreateTaxDescriptionSchema) { return this.repo.create(input); }
  update(id: string, input: CreateTaxDescriptionSchema) { return this.repo.update(id, input); }
  updateStatus(id: string) { return this.repo.changeStatus(id); }
  delete(id: string) { return this.repo.delete(id); }
}
