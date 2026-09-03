import { describe, expect, it } from "vitest";
import { moduleSeeds, validateModuleSeeds } from "../prisma/seed-data.js";

describe("module seed catalogue", () => {
  it("uses unique module and permission codes", () => {
    const moduleCodes = moduleSeeds.map((module) => module.code);
    const permissionCodes = moduleSeeds.flatMap((module) => module.permissions.map((permission) => permission.code));
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
    expect(new Set(permissionCodes).size).toBe(permissionCodes.length);
  });

  it("references existing parent modules", () => {
    const moduleIds = new Set(moduleSeeds.map((module) => module.id));
    for (const module of moduleSeeds) {
      if (module.parentId) expect(moduleIds.has(module.parentId)).toBe(true);
    }
  });

  it("matches the validated 39-node sidebar catalogue", () => {
    expect(() => validateModuleSeeds()).not.toThrow();
    expect(moduleSeeds).toHaveLength(39);
    expect(moduleSeeds.flatMap((module) => module.permissions)).toHaveLength(184);
  });
});
