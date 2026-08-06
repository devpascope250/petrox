import { buildModuleTree } from "./module-tree.js";
import { ModulesRepository } from "./modules.repository.js";

export class ModulesService {
  constructor(private readonly repository: ModulesRepository) {}

  async sidebarForRole(roleId: string) {
    return buildModuleTree(await this.repository.listAccessForRole(roleId));
  }
}
