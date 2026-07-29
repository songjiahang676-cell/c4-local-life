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

describe("listing submission risk rules v4", () => {
  it("auto-approves an established account with a complete risk-based policy", () => {
    expect(evaluateListingSubmissionRisk(baseline())).toEqual({
      ruleSetKey: "listing-submission",
      ruleSetVersion: 4,
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

  it("queues enforced duplicate candidates while dry-run candidates remain non-blocking", () => {
    const enforced = evaluateListingSubmissionRisk({
      ...baseline(),
      enforcedDuplicateCandidateCount: 1,
    });
    const dryRun = evaluateListingSubmissionRisk({
      ...baseline(),
      enforcedDuplicateCandidateCount: 0,
    });

    expect(enforced).toMatchObject({
      riskTier: "MEDIUM",
      hits: [
        {
          ruleCode: "POSSIBLE_DUPLICATE",
          ruleVersion: 1,
          severity: "MEDIUM",
          evidenceKey: "duplicate_candidates",
        },
      ],
    });
    expect(dryRun.riskTier).toBe("LOW");
  });

  it("escalates external-payment requests ahead of medium-risk hits", () => {
    const result = evaluateListingSubmissionRisk({
      ...baseline(),
      body: "Synthetic test only: request a gift card before a viewing.",
    });

    expect(result).toMatchObject({
      ruleSetVersion: 4,
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

  it("routes suspected discriminatory Job wording to human review without retaining raw text", () => {
    const result = evaluateListingSubmissionRisk({
      ...baseline(),
      listingType: "JOB",
      body: "Synthetic policy test: women only.",
    });

    expect(result).toMatchObject({
      ruleSetVersion: 4,
      riskTier: "MEDIUM",
      hits: [
        {
          ruleCode: "EMPLOYMENT_POLICY_RISK",
          ruleVersion: 1,
          severity: "MEDIUM",
          evidenceKey: "body",
        },
      ],
    });
    expect(JSON.stringify(result.hits)).not.toContain("women only");
  });

  it("escalates prohibited Secondhand goods without retaining the matched text", () => {
    const result = evaluateListingSubmissionRisk({
      ...baseline(),
      listingType: "SECONDHAND",
      title: "Synthetic counterfeit item",
    });

    expect(result).toMatchObject({
      ruleSetVersion: 4,
      riskTier: "HIGH",
      hits: [
        {
          ruleCode: "PROHIBITED_GOODS_RISK",
          ruleVersion: 1,
          severity: "HIGH",
          evidenceKey: "title",
        },
      ],
    });
    expect(JSON.stringify(result.hits)).not.toContain("counterfeit");
  });
});
