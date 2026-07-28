import { describe, expect, it } from "vitest";
import {
  passwordLoginRequestSchema,
  passwordRecoveryConfirmRequestSchema,
  passwordRecoveryRequestSchema,
} from "../src/index";

describe("password authentication contracts", () => {
  it("normalizes account identifiers while preserving password bytes for the KDF boundary", () => {
    expect(
      passwordLoginRequestSchema.parse({
        identifier: "  Member@Example.Invalid  ",
        password: "  A password whose spaces are intentional  ",
      }),
    ).toEqual({
      identifier: "Member@Example.Invalid",
      password: "  A password whose spaces are intentional  ",
    });
    expect(
      passwordLoginRequestSchema.safeParse({
        identifier: "+19495550123",
        password: "A phone login password",
      }).success,
    ).toBe(true);
  });

  it("binds recovery channels to email or E.164 destinations and rejects extra fields", () => {
    expect(
      passwordRecoveryRequestSchema.safeParse({
        channel: "EMAIL",
        destination: "member@example.invalid",
      }).success,
    ).toBe(true);
    for (const input of [
      { channel: "EMAIL", destination: "+19495550123" },
      { channel: "SMS", destination: "member@example.invalid" },
      { channel: "SMS", destination: "+19495550123", userId: "not-accepted" },
    ]) {
      expect(passwordRecoveryRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("requires an opaque UUID request, 256-bit token encoding, and bounded password", () => {
    expect(
      passwordRecoveryConfirmRequestSchema.safeParse({
        recoveryRequestId: "40000000-0000-4000-8000-000000000001",
        token: "A".repeat(43),
        newPassword: "A sufficiently long password!",
      }).success,
    ).toBe(true);
    for (const input of [
      {
        recoveryRequestId: "not-a-uuid",
        token: "A".repeat(43),
        newPassword: "A sufficiently long password!",
      },
      {
        recoveryRequestId: "40000000-0000-4000-8000-000000000001",
        token: "too-short",
        newPassword: "A sufficiently long password!",
      },
      {
        recoveryRequestId: "40000000-0000-4000-8000-000000000001",
        token: "A".repeat(43),
        newPassword: "short",
      },
    ]) {
      expect(passwordRecoveryConfirmRequestSchema.safeParse(input).success).toBe(false);
    }
  });
});
