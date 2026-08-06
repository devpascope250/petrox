import type { PaginationQuery } from "../validation/index.js";

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedData<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function paginationArgs(query: PaginationQuery) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize
  } as const;
}

export function paginatedData<T>(items: T[], total: number, query: PaginationQuery): PaginatedData<T> {
  const totalPages = Math.ceil(total / query.pageSize);
  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1
    }
  };
}
