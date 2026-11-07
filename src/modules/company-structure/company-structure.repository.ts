import { Prisma, type PrismaClient } from "../../../prisma/generated/prisma/client.js";
import { paginationArgs } from "../../shared/pagination/index.js";
import { NotFoundError } from "../../utils/errors.js";
import type {
  CreateDepartmentSchema,
  CreateOfficeSchema,
  DepartmentListQuery,
  OfficeListQuery
} from "./company-structure.schema.js";

const departmentSelect = {
  id: true,
  departmentName: true,
  departmentCode: true,
  description: true,
  status: true,
  createdAt: true,
  /// How many offices sit under it, so the list can say whether closing it
  /// would leave people behind.
  _count: { select: { offices: true } }
} satisfies Prisma.CompanyDepartmentSelect;

const officeSelect = {
  id: true,
  officeName: true,
  officeCode: true,
  departmentId: true,
  status: true,
  createdAt: true,
  department: {
    select: { id: true, departmentName: true, departmentCode: true, status: true }
  },
  /// How many people sit in it. A closed office keeps its staff, so this is
  /// what the page shows instead of pretending it is empty.
  _count: { select: { users: true } }
} satisfies Prisma.CompanyOfficeSelect;

export class CompanyStructureRepository {
  constructor(private db: PrismaClient) {}

  /* -------------------------------------------------------------- */
  /* Departments                                                     */
  /* -------------------------------------------------------------- */

  listDepartments(query: DepartmentListQuery) {
    const where = this.departmentsMatching(query);
    return this.db.$transaction([
      this.db.companyDepartment.findMany({
        ...paginationArgs(query),
        where,
        // `createdAt` alone is not a total order: rows written in the same
        // millisecond can come back in a different order per query, which
        // repeats one row across two pages and drops another.
        orderBy: [{ departmentName: "asc" }, { id: "asc" }],
        select: departmentSelect
      }),
      this.db.companyDepartment.count({ where })
    ]);
  }

  findDepartment(id: string) {
    return this.db.companyDepartment.findUnique({ where: { id }, select: departmentSelect });
  }

  /** By code, for the uniqueness check. `exceptId` is the row being edited. */
  findDepartmentByCode(departmentCode: string, exceptId?: string) {
    return this.db.companyDepartment.findFirst({
      where: { departmentCode, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, departmentName: true }
    });
  }

  createDepartment(data: CreateDepartmentSchema) {
    return this.db.companyDepartment.create({ data, select: departmentSelect });
  }

  async updateDepartment(id: string, data: CreateDepartmentSchema) {
    if (!(await this.findDepartment(id))) throw new NotFoundError("Department");
    return this.db.companyDepartment.update({ where: { id }, data, select: departmentSelect });
  }

  async changeDepartmentStatus(id: string) {
    const department = await this.findDepartment(id);
    if (!department) throw new NotFoundError("Department");
    return this.db.companyDepartment.update({
      where: { id },
      data: { status: department.status === "active" ? "inactive" : "active" },
      select: departmentSelect
    });
  }

  private departmentsMatching(query: DepartmentListQuery): Prisma.CompanyDepartmentWhereInput {
    const term = query.search?.trim();
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(term
        ? {
            OR: [
              { departmentName: { contains: term } },
              { departmentCode: { contains: term } },
              { description: { contains: term } }
            ]
          }
        : {})
    };
  }

  /* -------------------------------------------------------------- */
  /* Offices                                                         */
  /* -------------------------------------------------------------- */

  listOffices(query: OfficeListQuery) {
    const where = this.officesMatching(query);
    return this.db.$transaction([
      this.db.companyOffice.findMany({
        ...paginationArgs(query),
        where,
        // Grouped by department, the way the org chart reads.
        orderBy: [
          { department: { departmentName: "asc" } },
          { officeName: "asc" },
          { id: "asc" }
        ],
        select: officeSelect
      }),
      this.db.companyOffice.count({ where })
    ]);
  }

  findOffice(id: string) {
    return this.db.companyOffice.findUnique({ where: { id }, select: officeSelect });
  }

  findOfficeByCode(officeCode: string, exceptId?: string) {
    return this.db.companyOffice.findFirst({
      where: { officeCode, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, officeName: true }
    });
  }

  createOffice(data: CreateOfficeSchema) {
    return this.db.companyOffice.create({ data, select: officeSelect });
  }

  async updateOffice(id: string, data: CreateOfficeSchema) {
    if (!(await this.findOffice(id))) throw new NotFoundError("Office");
    return this.db.companyOffice.update({ where: { id }, data, select: officeSelect });
  }

  async changeOfficeStatus(id: string) {
    const office = await this.findOffice(id);
    if (!office) throw new NotFoundError("Office");
    return this.db.companyOffice.update({
      where: { id },
      data: { status: office.status === "active" ? "inactive" : "active" },
      select: officeSelect
    });
  }

  private officesMatching(query: OfficeListQuery): Prisma.CompanyOfficeWhereInput {
    const term = query.search?.trim();
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(term
        ? {
            OR: [
              { officeName: { contains: term } },
              { officeCode: { contains: term } },
              // The department is how people name an office out loud, so it is
              // searchable from here too.
              { department: { is: { departmentName: { contains: term } } } },
              { department: { is: { departmentCode: { contains: term } } } }
            ]
          }
        : {})
    };
  }
}
