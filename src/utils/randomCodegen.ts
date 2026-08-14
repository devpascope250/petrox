import { randomBytes } from "node:crypto";

export function generateOrderCode(): string {
  return `ORD-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function generatePfiCode(): string {
  return `PFI${randomBytes(5).toString("hex").toUpperCase()}`
}