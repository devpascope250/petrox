import { NotFoundError } from "../../utils/errors.js";
import { ItemToleranceRateRepository } from "./item-tolerance-rate.repository.js";
import type {
  CreateItemToleranceRateInput,
  UpdateItemToleranceRateInput,
} from "./item-tolerance-rate.schema.js";

export class ItemToleranceRateService {
  constructor(private repo: ItemToleranceRateRepository) {}

  list() {
    return this.repo.list();
  }

  async find(id: string) {
    const toleranceRate = await this.repo.find(id);
    if (!toleranceRate) throw new NotFoundError("Item tolerance rate");
    return toleranceRate;
  }

  async create(input: CreateItemToleranceRateInput) {
    await this.ensureItem(input.itemId);
    return this.repo.create(input);
  }

  async update(id: string, input: UpdateItemToleranceRateInput) {
    await this.find(id);
    if (input.itemId) await this.ensureItem(input.itemId);
    return this.repo.update(id, input);
  }

  async changeStatus(id: string) {
    const toleranceRate = await this.find(id);
    const status = toleranceRate.status === "active" ? "inactive" : "active";
    return this.repo.changeStatus(id, status);
  }

  private async ensureItem(id: string) {
    if (!(await this.repo.findItem(id))) throw new NotFoundError("Item");
  }

  getItemToleranceRateByItemId(itemId: string) {
    return this.repo.getItemToleranceRateByItemId(itemId);
  }
}
