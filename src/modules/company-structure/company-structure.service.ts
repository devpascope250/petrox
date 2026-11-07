import { paginatedData } from "../../shared/pagination/index.js";
import { BusinessError, ConflictError, NotFoundError } from "../../utils/errors.js";
import { CompanyStructureRepository } from "./company-structure.repository.js";
import type {
  CreateDepartmentSchema,
  CreateOfficeSchema,
  DepartmentListQuery,
  OfficeListQuery
} from "./company-structure.schema.js";

/**
 * The company's own structure: departments, and the offices under them.
 *
 * Neither can be deleted, the way nothing else in this API can be: an office
 * is on the staff who sit in it and a department is on its offices, so the
 * correction path is an edit, and taking one out of use is a status change.
 */
export class CompanyStructureService {
  constructor(private repo: CompanyStructureRepository) {}

  /* -------------------------------------------------------------- */
  /* Departments                                                     */
  /* -------------------------------------------------------------- */

  async listDepartments(query: DepartmentListQuery) {
    const [items, total] = await this.repo.listDepartments(query);
    return paginatedData(items, total, query);
  }

  async findDepartment(id: string) {
    const department = await this.repo.findDepartment(id);
    if (!department) throw new NotFoundError("Department");
    return department;
  }

  async createDepartment(input: CreateDepartmentSchema) {
    await this.assertDepartmentCodeFree(input.departmentCode);
    return this.repo.createDepartment(input);
  }

  async updateDepartment(id: string, input: CreateDepartmentSchema) {
    await this.assertDepartmentCodeFree(input.departmentCode, id);
    return this.repo.updateDepartment(id, input);
  }

  async updateDepartmentStatus(id: string) {
    return this.repo.changeDepartmentStatus(id);
  }

  /* -------------------------------------------------------------- */
  /* Offices                                                         */
  /* -------------------------------------------------------------- */

  async listOffices(query: OfficeListQuery) {
    const [items, total] = await this.repo.listOffices(query);
    return paginatedData(items, total, query);
  }

  async findOffice(id: string) {
    const office = await this.repo.findOffice(id);
    if (!office) throw new NotFoundError("Office");
    return office;
  }

  async createOffice(input: CreateOfficeSchema) {
    await this.assertOfficeCodeFree(input.officeCode);
    await this.assertDepartmentOpen(input.departmentId);
    return this.repo.createOffice(input);
  }

  async updateOffice(id: string, input: CreateOfficeSchema) {
    await this.assertOfficeCodeFree(input.officeCode, id);
    const office = await this.findOffice(id);
    // Moving an office to another department has to land somewhere open;
    // staying where it is must not be blocked by its own department being
    // closed, or a closed department's offices could never be renamed.
    if (input.departmentId !== office.departmentId) {
      await this.assertDepartmentOpen(input.departmentId);
    }
    return this.repo.updateOffice(id, input);
  }

  async updateOfficeStatus(id: string) {
    return this.repo.changeOfficeStatus(id);
  }

  /* -------------------------------------------------------------- */

  /**
   * The code is free. Checked here rather than left to the unique index, so a
   * repeat comes back as a 409 naming the department that already holds it
   * instead of a database error the form cannot read.
   */
  private async assertDepartmentCodeFree(departmentCode: string, exceptId?: string) {
    const clash = await this.repo.findDepartmentByCode(departmentCode, exceptId);
    if (clash) {
      throw new ConflictError(
        "DEPARTMENT_CODE_TAKEN",
        `Code ${departmentCode} is already used by ${clash.departmentName}`
      );
    }
  }

  private async assertOfficeCodeFree(officeCode: string, exceptId?: string) {
    const clash = await this.repo.findOfficeByCode(officeCode, exceptId);
    if (clash) {
      throw new ConflictError(
        "OFFICE_CODE_TAKEN",
        `Code ${officeCode} is already used by ${clash.officeName}`
      );
    }
  }

  private async assertDepartmentOpen(departmentId: string) {
    const department = await this.findDepartment(departmentId);
    if (department.status !== "active") {
      throw new BusinessError(
        "DEPARTMENT_INACTIVE",
        `${department.departmentName} is closed. Reopen it, or choose another department.`
      );
    }
  }
}
