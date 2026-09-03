import { NotFoundError } from "../../utils/errors.js";
import { paginatedData } from "../../shared/pagination/index.js";
import type { PaginationQuery } from "../../shared/validation/index.js";
import { buildModuleTree } from "./module-tree.js";
import { ModuleItemsSchemaBody, ModuleSchemaBody, ModuleSortingSchema, UpdateModuleSchemaBody } from "./module.schema.js";
import { ModulesRepository } from "./modules.repository.js";

export class ModulesService {
  constructor(private readonly repository: ModulesRepository) {}

  async sidebarForRole(roleId: string) {
    return buildModuleTree(await this.repository.listAccessForRole(roleId));
  }

  async findOne(id: string) {
    return await this.repository.find(id);
  }

  async findAll() {
    return await this.repository.findAll();
  }

  async createModule (data: ModuleSchemaBody) {
    return await this.repository.create(data);
  }

  async deleteModule (id: string) {
    if(!await this.findOne(id)) throw new NotFoundError();
    return await this.repository.delete(id);
  }

   async updateModule (data: UpdateModuleSchemaBody) {
    if(!await this.findOne(data.id)) throw new NotFoundError();
    return await this.repository.update(data.id, data);
  }

  async updateSorting(data: ModuleSortingSchema) {
    return await this.repository.updateSorting(data);
  }
}
