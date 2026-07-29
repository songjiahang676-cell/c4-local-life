import { describe, expect, it } from "vitest";
import {
  appealModerationActionRequestSchema,
  createModerationAppealRequestSchema,
  createReportRequestSchema,
  listAppealModerationCasesQuerySchema,
  listModerationCasesQuerySchema,
  listReportModerationCasesQuerySchema,
  moderationActionRequestSchema,
  reportModerationActionRequestSchema,
} from "../src";

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
      moderationActionRequestSchema.parse({
        action: "REQUEST_CHANGES",
        reasonCode: "DUPLICATE_CONTENT",
      }),
    ).toEqual({
      action: "REQUEST_CHANGES",
      reasonCode: "DUPLICATE_CONTENT",
    });
    expect(
      moderationActionRequestSchema.safeParse({
        action: "APPROVE",
        reasonCode: "DUPLICATE_CONTENT",
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

  it("accepts only bounded listing-report evidence and stable reason codes", () => {
    expect(
      createReportRequestSchema.parse({
        targetType: "LISTING",
        targetId: "40000000-0000-4000-8000-000000000091",
        reasonCode: "SCAM_OR_FRAUD",
        details: "The publisher requested an off-platform deposit.",
      }),
    ).toMatchObject({
      targetType: "LISTING",
      reasonCode: "SCAM_OR_FRAUD",
    });
    for (const invalid of [
      { targetType: "MESSAGE" },
      { reasonCode: "ARBITRARY_REASON" },
      { details: "short" },
      { details: `safe${"\u202e"}spoofed detail` },
      { unexpected: "field" },
    ]) {
      expect(
        createReportRequestSchema.safeParse({
          targetType: "LISTING",
          targetId: "40000000-0000-4000-8000-000000000091",
          reasonCode: "SCAM_OR_FRAUD",
          details: "The publisher requested an off-platform deposit.",
          ...invalid,
        }).success,
      ).toBe(false);
    }
  });

  it("binds report and appeal decisions to their allowed reasons", () => {
    expect(
      reportModerationActionRequestSchema.parse({
        action: "REMOVE_CONTENT",
        reasonCode: "CONFIRMED_SCAM",
      }),
    ).toEqual({ action: "REMOVE_CONTENT", reasonCode: "CONFIRMED_SCAM" });
    expect(
      reportModerationActionRequestSchema.safeParse({
        action: "DISMISS",
        reasonCode: "CONFIRMED_SCAM",
      }).success,
    ).toBe(false);
    expect(
      appealModerationActionRequestSchema.parse({
        action: "RESTORE",
        reasonCode: "ACTION_OVERTURNED",
      }),
    ).toEqual({ action: "RESTORE", reasonCode: "ACTION_OVERTURNED" });
    expect(
      appealModerationActionRequestSchema.safeParse({
        action: "UPHOLD",
        reasonCode: "ACTION_OVERTURNED",
      }).success,
    ).toBe(false);
  });

  it("requires a meaningful appeal statement and bounded queue cursors", () => {
    expect(
      createModerationAppealRequestSchema.parse({
        moderationActionId: "40000000-0000-4000-8000-000000000092",
        statement: "The cited claim is supported by the attached public record.",
      }),
    ).toMatchObject({
      moderationActionId: "40000000-0000-4000-8000-000000000092",
    });
    expect(
      createModerationAppealRequestSchema.safeParse({
        moderationActionId: "40000000-0000-4000-8000-000000000092",
        statement: "too short",
      }).success,
    ).toBe(false);
    expect(listReportModerationCasesQuerySchema.parse({})).toEqual({
      status: "OPEN",
      limit: 20,
    });
    expect(listAppealModerationCasesQuerySchema.parse({})).toEqual({
      status: "OPEN",
      limit: 20,
    });
    expect(listReportModerationCasesQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(listAppealModerationCasesQuerySchema.safeParse({ status: "ARBITRARY" }).success).toBe(
      false,
    );
  });
});
