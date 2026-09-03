import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { CompanyAccountRepository } from "./company-account.repository.js";
import type {
  CreateCompanyAccountInput,
  UpdateCompanyAccountInput
} from "./company-account.schema.js";

export class CompanyAccountService {
  constructor(private repo: CompanyAccountRepository) {}

  async list(query: PaginationQuery) {
    const [items, total] = await this.repo.list(query);
    return paginatedData(items, total, query);
  }

  async find(id: string) {
    const account = await this.repo.find(id);
    if (!account) throw new NotFoundError("Company account");
    return account;
  }

  create(input: CreateCompanyAccountInput, createdAtBy: string) {
    return this.repo.create(input, createdAtBy);
  }

  async update(id: string, input: UpdateCompanyAccountInput) {
    await this.find(id);
    return this.repo.update(id, input);
  }

  async changeStatus(id: string) {
    const account = await this.find(id);
    const status = account.status === "active" ? "inactive" : "active";
    return this.repo.changeStatus(id, status);
  }


  
}
