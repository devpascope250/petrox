import { describe, expect, it } from "vitest";
import { generateClientCode, generateTemporaryPin, hashPin, verifyPin } from "../src/utils/crypto.js";

describe("generated client and user credentials", () => {
  it("generates a six-digit temporary PIN and stores a verifiable hash", () => {
    const pin = generateTemporaryPin();
    const hash = hashPin(pin, "test-secret");
    expect(pin).toMatch(/^\d{6}$/);
    expect(hash).not.toContain(pin);
    expect(verifyPin(pin, hash, "test-secret")).toBe(true);
  });

  it("generates client codes in the server-owned format", () => {
    expect(generateClientCode()).toMatch(/^CLT-[A-F0-9]{12}$/);
  });
});
