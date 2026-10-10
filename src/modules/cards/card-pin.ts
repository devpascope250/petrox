import { hashPin, verifyPin } from "../../utils/crypto.js";

/** The PIN a card is assigned with, until it is changed. */
export const DEFAULT_CARD_PIN = "123456";

/**
 * Card PINs are stored as an HMAC keyed with `PIN_HMAC_SECRET`, never as the
 * digits. The `card-pin:` prefix keeps a card PIN's hash different from a
 * user PIN's even when the digits are the same.
 */
export function hashCardPin(pin: string, secret: string) {
  return hashPin(`card-pin:${pin}`, secret);
}

/** Constant-time comparison of a typed PIN with a stored hash. */
export function verifyCardPin(pin: string, stored: string | null, secret: string) {
  if (!stored) return false;
  return verifyPin(`card-pin:${pin}`, stored, secret);
}
