import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeAndValidatePassword,
  verifyPassword,
  WeakPasswordError,
} from "../src/modules/auth/password-crypto";

const pepper = "synthetic-password-pepper-with-more-than-32-bytes";

describe("password cryptography", () => {
  it("stores a salted scrypt verifier and accepts only the matching password and pepper", async () => {
    const password = "A long synthetic password 2026!";
    const first = await hashPassword(password, pepper);
    const second = await hashPassword(password, pepper);

    expect(first).toMatch(/^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{86}$/);
    expect(second).not.toBe(first);
    await expect(verifyPassword(password, first, pepper)).resolves.toBe(true);
    await expect(verifyPassword("A different synthetic password!", first, pepper)).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword(password, first, "a-different-pepper-with-more-than-32-bytes"),
    ).resolves.toBe(false);
  });

  it("normalizes Unicode and rejects short, control-bearing, and blocked passwords", () => {
    expect(normalizeAndValidatePassword("Cafe\u0301 has a long passphrase!")).toBe(
      "Café has a long passphrase!",
    );
    for (const password of [
      "too short",
      "valid length but\u0000control",
      "passwordpassword",
      "correcthorsebatterystaple",
    ]) {
      expect(() => normalizeAndValidatePassword(password)).toThrow(WeakPasswordError);
    }
  });

  it("rejects malformed or unsupported stored verifier formats without throwing", async () => {
    await expect(verifyPassword("irrelevant password", "$argon2id$bad", pepper)).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword("irrelevant password", "$scrypt$ln=17,r=8,p=1$short$also-short", pepper),
    ).resolves.toBe(false);
  });
});
