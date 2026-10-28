import { paginatedData } from "../../shared/pagination/index.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { FeeRepository } from "./fee.repository.js";
import type { AssignFeesSchema, CreateFeeTypeSchema, FeeTypeListQuery } from "./fee.schema.js";

export class FeeService {
  constructor(private repo: FeeRepository) {}

  async listTypes(query: FeeTypeListQuery) {
    const [items, total] = await this.repo.listTypes(query);
    return paginatedData(items, total, query);
  }

  activeTypes() {
    return this.repo.activeTypes();
  }

  async findType(id: string) {
    const type = await this.repo.findType(id);
    if (!type) throw new NotFoundError("Fee type");
    return type;
  }

  createType(input: CreateFeeTypeSchema) {
    return this.named(() => this.repo.createType(input), input.name);
  }

  updateType(id: string, input: CreateFeeTypeSchema) {
    return this.named(() => this.repo.updateType(id, input), input.name);
  }

  changeTypeStatus(id: string) {
    return this.repo.changeTypeStatus(id);
  }

  assignToCentralStock(centralStockId: string, input: AssignFeesSchema, userId: string | null) {
    return this.repo.assign({ centralStockId }, input, userId);
  }

  assignToPfi(pfiId: string, input: AssignFeesSchema, userId: string | null) {
    return this.repo.assign({ pfiId }, input, userId);
  }

  forCentralStock(centralStockId: string) {
    return this.repo.forCentralStock(centralStockId);
  }

  forPfi(pfiId: string) {
    return this.repo.forPfi(pfiId);
  }

  /** One fee per name, so a list of charges cannot read ambiguously. */
  private async named<T>(write: () => Promise<T>, name: string) {
    try {
      return await write();
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictError("FEE_TYPE_EXISTS", `A fee called "${name}" already exists`);
      }
      throw error;
    }
  }
}
