import type { PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import type {
  CreateCompanyAccountInput,
  UpdateCompanyAccountInput
} from "./company-account.schema.js";

const companyAccountSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  siteId: true,
  site: { select: { id: true, name: true } },
  requiredReference: true,
  status: true,
  createdAtBy: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true
    }
  },
  createdAt: true,
  updatedAt: true
} as const;

export class CompanyAccountRepository {
  constructor(private db: PrismaClient) {}

  list(query: PaginationQuery) {
    return this.db.$transaction([
      this.db.companyAccount.findMany({
        ...paginationArgs(query),
        orderBy: { createdAt: "desc" },
        select: companyAccountSelect
      }),
      this.db.companyAccount.count()
    ]);
  }

  find(id: string) {
    return this.db.companyAccount.findUnique({
      where: { id },
      select: companyAccountSelect
    });
  }

  create(input: CreateCompanyAccountInput, createdAtBy: string) {
    return this.db.companyAccount.create({
      data: { ...input, createdAtBy },
      select: companyAccountSelect
    });
  }

  update(id: string, input: UpdateCompanyAccountInput) {
    return this.db.companyAccount.update({
      where: { id },
      data: input,
      select: companyAccountSelect
    });
  }

  findSite(id: string) {
    return this.db.tblSite.findUnique({ where: { id }, select: { id: true } });
  }

  changeStatus(id: string, status: "active" | "inactive") {
    return this.db.companyAccount.update({
      where: { id },
      data: { status },
      select: companyAccountSelect
    });
  }
}
