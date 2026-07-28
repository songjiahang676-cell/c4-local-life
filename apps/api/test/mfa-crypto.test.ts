import { describe, expect, it } from "vitest";
import {
  decodeBase32,
  decryptTotpSecret,
  encodeBase32,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotpCode,
  normalizeRecoveryCode,
  totpCode,
} from "../src/modules/admin/mfa-crypto";

describe("Admin MFA cryptography", () => {
  it("matches RFC 4226 HOTP and RFC 6238 SHA-1 TOTP vectors", () => {
    const sharedSecret = Buffer.from("12345678901234567890", "ascii");
    const hotpVectors = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    expect(
      hotpVectors.map((_expected, counter) => hotpCode(sharedSecret, BigInt(counter))),
    ).toEqual(hotpVectors);

    const totpVectors = [
      [59, "94287082"],
      [1_111_111_109, "07081804"],
      [1_111_111_111, "14050471"],
      [1_234_567_890, "89005924"],
      [2_000_000_000, "69279037"],
      [20_000_000_000, "65353130"],
    ] as const;
    for (const [seconds, expected] of totpVectors) {
      expect(totpCode(sharedSecret, new Date(seconds * 1_000), 8, "sha1")).toBe(expected);
    }
  });

  it("round-trips base32 and authenticated encryption and rejects tampering", () => {
    const raw = Buffer.from("synthetic-totp-secret", "utf8");
    expect(decodeBase32(encodeBase32(raw))).toEqual(raw);

    const secret = encodeBase32(Buffer.alloc(20, 7));
    const masterSecret = "mfa-test-master-secret-with-at-least-32-bytes";
    const encrypted = encryptTotpSecret(secret, masterSecret);
    expect(encrypted).not.toContain(secret);
    expect(decryptTotpSecret(encrypted, masterSecret)).toBe(secret);

    const parts = encrypted.split(".");
    const authenticationTag = Buffer.from(parts[3] ?? "", "base64url");
    authenticationTag[0] = (authenticationTag[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], parts[2], authenticationTag.toString("base64url")].join(
      ".",
    );
    expect(() => decryptTotpSecret(tampered, masterSecret)).toThrow();
  });

  it("creates normalized, one-time-code-shaped recovery secrets with domain-separated hashes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/);
      expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replaceAll("-", ""));
      expect(hashRecoveryCode(code, "mfa-test-master-secret-with-at-least-32-bytes")).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });
});
