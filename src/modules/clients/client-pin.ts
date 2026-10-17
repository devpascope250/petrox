import { hashPin, verifyPin } from "../../utils/crypto.js";

/**
 * A client's PIN, entered at the pump to pay with the client's coupons. The
 * `client-pin:` prefix keeps its hash different from a user's or a card's
 * with the same digits.
 */
export function hashClientPin(pin: string, secret: string) {
  return hashPin(`client-pin:${pin}`, secret);
}

export function verifyClientPin(pin: string, stored: string, secret: string) {
  return verifyPin(`client-pin:${pin}`, stored, secret);
}
