import type { ItemsAccessRow, ItemsList } from "./items.types.js";


export function buildItemTree(rows: ItemsAccessRow[]): ItemsList[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const visibleIds = new Set(rows.filter((row) => row.id).map((row) => row.id));

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
  const childrenByParent = new Map<string | null, ItemsAccessRow[]>();
  for (const row of visibleRows) {
    const parentId = row.parentId && visibleIds.has(row.parentId) ? row.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(parentId, siblings);
  }

  const buildChildren = (parentId: string | null, ancestors: ReadonlySet<string>): ItemsList[] =>
    (childrenByParent.get(parentId) ?? [])
      .filter((row) => !ancestors.has(row.id))
      .map((row) => {
        const nextAncestors = new Set(ancestors).add(row.id);
        return {
          id: row.id,
          name: row.name,
          baseUnitId: row.baseUnitId!,
          descriptions: row.descriptions,
          items: buildChildren(row.id, nextAncestors)
        };
      });

  return buildChildren(null, new Set());
}
