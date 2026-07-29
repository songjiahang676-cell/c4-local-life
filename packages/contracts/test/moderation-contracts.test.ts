import { describe, expect, it } from "vitest";
import { listModerationCasesQuerySchema, moderationActionRequestSchema } from "../src";

describe("moderation contracts", () => {
  it("applies bounded queue defaults and rejects oversized or unknown filters", () => {
    expect(listModerationCasesQuerySchema.parse({})).toEqual({
      queue: "listing-submission",
      status: "OPEN",
      limit: 20,
    });
    expect(
      listModerationCasesQuerySchema.parse({
        riskTier: "HIGH",
        minPriority: "80",
        limit: "50",
      }),
    ).toEqual({
      queue: "listing-submission",
      status: "OPEN",
      riskTier: "HIGH",
      minPriority: 80,
      limit: 50,
    });
    expect(listModerationCasesQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listModerationCasesQuerySchema.safeParse({ queue: "arbitrary" }).success).toBe(false);
    expect(listModerationCasesQuerySchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  it("binds stable reason codes to actions and constrains internal notes", () => {
    expect(
      moderationActionRequestSchema.parse({
        action: "APPROVE",
        reasonCode: "CONTENT_POLICY_COMPLIANT",
      }),
    ).toEqual({
      action: "APPROVE",
      reasonCode: "CONTENT_POLICY_COMPLIANT",
    });
    expect(
      moderationActionRequestSchema.safeParse({
        action: "APPROVE",
        reasonCode: "PROHIBITED_CONTENT",
      }).success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({
        action: "REJECT",
        reasonCode: "PROHIBITED_CONTENT",
        note: `valid${"\u202e"}spoof`,
      }).success,
    ).toBe(false);
    expect(
      moderationActionRequestSchema.safeParse({
        action: "REJECT",
        reasonCode: "PROHIBITED_CONTENT",
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});
