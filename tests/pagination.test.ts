import { describe, expect, it } from "vitest";
import { paginatedData, paginationArgs } from "../src/shared/pagination/index.js";

describe("shared pagination", () => {
  it("converts page input to database skip/take arguments", () => {
    expect(paginationArgs({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
  });

  it("builds navigation metadata", () => {
    expect(paginatedData(["item"], 45, { page: 2, pageSize: 20 })).toEqual({
      items: ["item"],
      pagination: {
        page: 2,
        pageSize: 20,
        total: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true
      }
    });
  });

  it("handles empty collections without inventing pages", () => {
    expect(paginatedData([], 0, { page: 1, pageSize: 20 }).pagination).toMatchObject({
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false
    });
  });
});
