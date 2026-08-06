import { describe, expect, it } from "vitest";
import { buildModuleTree } from "../src/modules/modules/module-tree.js";
import type { ModuleAccessRow } from "../src/modules/modules/modules.types.js";

const rows: ModuleAccessRow[] = [
  { id: "root", name: "Administration", code: "administration", parentId: null, sorting: 20, hasPermission: false },
  { id: "users", name: "Users", code: "users", parentId: "root", sorting: 20, hasPermission: false },
  { id: "create", name: "Create user", code: "users-create", parentId: "users", sorting: 10, hasPermission: true },
  { id: "roles", name: "Roles", code: "roles", parentId: "root", sorting: 10, hasPermission: true },
  { id: "hidden", name: "Hidden", code: "hidden", parentId: null, sorting: 1, hasPermission: false }
];

describe("recursive module hierarchy", () => {
  it("includes ancestors of deeply permitted modules", () => {
    const tree = buildModuleTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].code).toBe("administration");
    expect(tree[0].children.map((item) => item.code)).toEqual(["roles", "users"]);
    expect(tree[0].children[1].children[0].code).toBe("users-create");
  });

  it("excludes branches without any permitted module", () => {
    expect(JSON.stringify(buildModuleTree(rows))).not.toContain("hidden");
  });

  it("returns an empty tree when the role has no permissions", () => {
    expect(buildModuleTree(rows.map((row) => ({ ...row, hasPermission: false })))).toEqual([]);
  });
});
