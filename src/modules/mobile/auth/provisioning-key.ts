import { randomInt } from "node:crypto";
import { hashToken } from "../../../utils/crypto.js";

/** Crockford base32: no I, L, O or U, so the key survives being read aloud or typed. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * A new key such as `IK-7GQ2-M9XA-4KTD`: 12 random characters, 60 bits,
 * from the system's cryptographically secure generator.
 */
export function generateProvisioningKey(): string {
  const groups = Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""));
  return `IK-${groups.join("-")}`;
}

/**
 * Case, spaces and dashes do not matter, and the letters O, I and L read as 0,
 * 1 and 1. The `IK` prefix is dropped first (so its I is not read as a 1);
 * `QK`, the prefix keys were first issued with, is still accepted.
 */
export function normalizeProvisioningKey(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").replace(/^(IK|QK)/, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Only this hash is stored — never the key. */
export function hashProvisioningKey(raw: string): string {
  return hashToken(`site-provisioning-key:${normalizeProvisioningKey(raw)}`);
}
