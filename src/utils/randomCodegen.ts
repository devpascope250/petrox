import { randomBytes, randomInt } from "node:crypto";

export function generateOrderCode(): string {
  return `ORD-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function generatePfiCode(): string {
  return `PFI${randomBytes(5).toString("hex").toUpperCase()}`
}

/**
 * Characters a coupon code is made of: digits and capitals, less the ones
 * easily misread or mistyped — 0/O, 1/I/L — and U.
 */
const COUPON_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A coupon code a person can read out and type: `CPN-7KQ4-M9XT-2HRW`.
 * Twelve random characters over 30 give about 5×10^17 codes, so a clash with
 * the unique index is not a practical concern.
 */
export function generateCouponCode(): string {
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)]).join(""));
  return `CPN-${groups.join("-")}`;
}
