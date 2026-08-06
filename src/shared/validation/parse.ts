import type { z } from "zod";

/** Keeps parsing and inferred output types consistent at every HTTP boundary. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  return schema.parse(value);
}
