import { describe, expect, it } from "vitest";
import { moduleSeeds } from "../prisma/seed-data.js";

describe("module seed catalogue", () => {
  it("uses unique module and permission codes", () => {
    const moduleCodes = moduleSeeds.map((module) => module.code);
    const permissionCodes = moduleSeeds.flatMap((module) => module.permissions.map((permission) => permission.code));
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
    expect(new Set(permissionCodes).size).toBe(permissionCodes.length);
  });

  it("references existing parent modules", () => {
    const moduleCodes = new Set(moduleSeeds.map((module) => module.code));
    for (const module of moduleSeeds) {
      if (module.parentCode) expect(moduleCodes.has(module.parentCode)).toBe(true);
    }
  });

  it("provides permissions for every sidebar module", () => {
    expect(moduleSeeds.every((module) => module.permissions.length > 0)).toBe(true);
  });
});
