import type { ModuleAccessRow, SidebarModule } from "./modules.types.js";

const compareModules = (left: ModuleAccessRow, right: ModuleAccessRow) =>
  left.sorting - right.sorting || left.name.localeCompare(right.name);

export function buildModuleTree(rows: ModuleAccessRow[]): SidebarModule[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const visibleIds = new Set(rows.filter((row) => row.hasPermission).map((row) => row.id));

  // A permitted descendant requires its full ancestry so the frontend can render its path.
  for (const id of [...visibleIds]) {
    const visited = new Set<string>();
    let current = byId.get(id);
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      if (!byId.has(current.parentId)) break;
      visibleIds.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  const visibleRows = rows.filter((row) => visibleIds.has(row.id));
  const childrenByParent = new Map<string | null, ModuleAccessRow[]>();
  for (const row of visibleRows) {
    const parentId = row.parentId && visibleIds.has(row.parentId) ? row.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compareModules);

  const buildChildren = (parentId: string | null, ancestors: ReadonlySet<string>): SidebarModule[] =>
    (childrenByParent.get(parentId) ?? [])
      .filter((row) => !ancestors.has(row.id))
      .map((row) => {
        const nextAncestors = new Set(ancestors).add(row.id);
        return {
          id: row.id,
          name: row.name,
          code: row.code,
          sorting: row.sorting,
          children: buildChildren(row.id, nextAncestors)
        };
      });

  return buildChildren(null, new Set());
}
