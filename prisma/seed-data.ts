import sidebar from "../sidebar-flat.json" with { type: "json" };

export interface PermissionSeed {
  name: string;
  code: string;
  description: string;
}

export interface ModuleSeed {
  id: string;
  name: string;
  code: string;
  sorting: number;
  parentId: string | null;
  permissions: ReadonlyArray<PermissionSeed>;
}

interface SidebarNode {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  sorting: number;
  permissions?: string[];
}

function permissionName(code: string) {
  const parts = code.split(".");
  const action = parts.pop() ?? "manage";
  const subject = parts.join(" ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const verb = action === "read" ? "View" : `${action[0]?.toUpperCase() ?? ""}${action.slice(1)}`;
  return `${verb} ${subject}`;
}

export const moduleSeeds: ReadonlyArray<ModuleSeed> = (sidebar.data as SidebarNode[]).map((node) => ({
  id: node.id,
  name: node.name,
  code: node.code,
  sorting: node.sorting,
  parentId: node.parentId,
  permissions: (node.permissions ?? []).map((code) => ({
    code,
    name: permissionName(code),
    description: `${permissionName(code)} permission`,
  })),
}));

export function validateModuleSeeds(seeds: ReadonlyArray<ModuleSeed> = moduleSeeds) {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const permissionCodes = new Set<string>();

  for (const module of seeds) {
    if (ids.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    if (codes.has(module.code)) throw new Error(`Duplicate module code: ${module.code}`);
    ids.add(module.id);
    codes.add(module.code);
    for (const permission of module.permissions) {
      if (permissionCodes.has(permission.code)) throw new Error(`Duplicate permission code: ${permission.code}`);
      permissionCodes.add(permission.code);
    }
  }
  for (const module of seeds) {
    if (module.parentId && !ids.has(module.parentId)) {
      throw new Error(`Module ${module.code} references missing parent ${module.parentId}`);
    }
    if (module.parentId === module.id) throw new Error(`Module ${module.code} cannot parent itself`);
  }
}
