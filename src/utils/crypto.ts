import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const createOpaqueToken = () => randomBytes(48).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const hashPin = (pin: string, secret: string) =>
  createHmac("sha256", secret).update(pin).digest("hex");
export function verifyPin(pin: string, expected: string, secret: string): boolean {
  const actual = Buffer.from(hashPin(pin, secret), "hex");
  const stored = Buffer.from(expected, "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}
