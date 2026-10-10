import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_GRANTS, flattenModules, validateModuleTree } from "../prisma/seed.js";

/** Every permission code written in the API's source, e.g. "cards.read". */
function permissionCodesInSource(dir = "src"): Set<string> {
  const codes = new Set<string>();
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      permissionCodesInSource(file).forEach((code) => codes.add(code));
    } else if (file.endsWith(".ts")) {
      for (const match of readFileSync(file, "utf8").matchAll(/"([a-z][a-z0-9]*(?:\.[a-z0-9]+)*\.(?:read|create|edit|delete|manage))"/g)) {
        codes.add(match[1]);
      }
    }
  }
  return codes;
}

describe("seed module catalogue", () => {
  const modules = flattenModules();
  const seeded = new Set(modules.flatMap((module) => module.permissions.map((permission) => permission.code)));

  it("has unique module ids, codes and permission codes", () => {
    expect(() => validateModuleTree(modules)).not.toThrow();
  });

  it("lists every parent before its children", () => {
    const seen = new Set<string>();
    for (const module of modules) {
      if (module.parentCode) expect(seen.has(module.parentCode)).toBe(true);
      seen.add(module.code);
    }
  });

  it("seeds every permission the API checks", () => {
    const missing = [...permissionCodesInSource()].filter((code) => !seeded.has(code));
    expect(missing).toEqual([]);
  });

  it("only grants roles permissions that exist", () => {
    for (const codes of Object.values(ROLE_GRANTS)) {
      expect(codes.filter((code) => !seeded.has(code))).toEqual([]);
    }
  });
});
