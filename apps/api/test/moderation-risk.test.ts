import { describe, expect, it } from "vitest";
import {
  evaluateListingSubmissionRisk,
  type ListingSubmissionRiskInput,
} from "../src/modules/listings/moderation-risk";

const occurredAt = new Date("2026-07-28T12:00:00.000Z");

function baseline(): ListingSubmissionRiskInput {
  return {
    title: "Synthetic Irvine rental",
    summary: "A fictional test listing",
    body: "This content exists only for deterministic moderation tests.",
    accountCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
    occurredAt,
    publicationPolicy: {
      defaultLifetimeDays: 30,
      manualReviewRequired: false,
    },
  };
}

describe("listing submission risk rules v1", () => {
  it("auto-approves an established account with a complete risk-based policy", () => {
    expect(evaluateListingSubmissionRisk(baseline())).toEqual({
      ruleSetKey: "listing-submission",
      ruleSetVersion: 1,
      riskTier: "LOW",
      hits: [],
      defaultLifetimeDays: 30,
    });
  });

  it("queues medium-risk submissions with stable rule codes and no raw evidence", () => {
    const result = evaluateListingSubmissionRisk({
      ...baseline(),
      title: "Synthetic rental at test@example.invalid",
      accountCreatedAt: new Date("2026-07-27T12:00:00.000Z"),
      publicationPolicy: { manualReviewRequired: true },
    });

    expect(result.riskTier).toBe("MEDIUM");
    expect(result.hits.map((hit) => hit.ruleCode)).toEqual([
      "NEW_ACCOUNT",
      "CATEGORY_MANUAL_REVIEW",
      "PUBLICATION_POLICY_INCOMPLETE",
      "EXTERNAL_CONTACT",
    ]);
    expect(JSON.stringify(result.hits)).not.toContain("test@example.invalid");
  });

  it("escalates external-payment requests ahead of medium-risk hits", () => {
    const result = evaluateListingSubmissionRisk({
      ...baseline(),
      body: "Synthetic test only: request a gift card before a viewing.",
    });

    expect(result).toMatchObject({
      ruleSetVersion: 1,
      riskTier: "HIGH",
      hits: [
        {
          ruleCode: "EXTERNAL_PAYMENT_REQUEST",
          ruleVersion: 1,
          severity: "HIGH",
          evidenceKey: "body",
        },
      ],
    });
  });
});
