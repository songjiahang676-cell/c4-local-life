import type { ListingDuplicateCandidateMatch } from "@socal/database/listing-submission";
import { describe, expect, it } from "vitest";
import {
  classifyDuplicateCandidates,
  contactFingerprints,
  listingDuplicatePolicy,
} from "../src/modules/listings/duplicate-detection";

const candidate: ListingDuplicateCandidateMatch = {
  listingId: "10000000-0000-4000-8000-000000000051",
  listingVersion: 2,
  listingType: "RENTAL",
  title: "Synthetic similar rental",
  status: "PUBLISHED",
  publishedAt: new Date("2026-07-20T00:00:00.000Z"),
  titleScore: 0.7,
  bodyScore: 0.75,
  imageDistance: null,
  contactMatchCount: 0,
};

describe("listing duplicate policy v1", () => {
  it("creates stable domain-separated contact fingerprints without retaining raw PII", () => {
    const first = contactFingerprints({
      attributes: {
        contactEmail: " Test.User@Example.Invalid ",
        contactPhone: "(949) 555-0123",
        publicNote: "not fingerprinted",
      },
      formSchemaDefinition: {
        fields: [
          { key: "contactEmail", type: "EMAIL" },
          { key: "contactPhone", type: "PHONE" },
          { key: "publicNote", type: "TEXT" },
        ],
      },
      secret: "duplicate-fingerprint-secret-with-at-least-32-bytes",
    });
    const normalized = contactFingerprints({
      attributes: {
        contactEmail: "test.user@example.invalid",
        contactPhone: "+1 949 555 0123",
      },
      formSchemaDefinition: {
        fields: [
          { key: "contactEmail", type: "EMAIL" },
          { key: "contactPhone", type: "PHONE" },
        ],
      },
      secret: "duplicate-fingerprint-secret-with-at-least-32-bytes",
    });

    expect(first).toEqual(normalized);
    expect(first).toHaveLength(2);
    expect(first.every((value) => /^[0-9a-f]{64}$/.test(value))).toBe(true);
    expect(JSON.stringify(first)).not.toContain("example.invalid");
    expect(JSON.stringify(first)).not.toContain("949");
  });

  it("retains observation candidates as dry-run evidence without enforcing review", () => {
    const result = classifyDuplicateCandidates([candidate]);

    expect(result).toMatchObject({
      enforcedCandidateCount: 0,
      candidates: [
        {
          candidateListingId: candidate.listingId,
          thresholdVersion: listingDuplicatePolicy.version,
          mode: "DRY_RUN",
          confidence: "MEDIUM",
          matchedSignals: ["TEXT"],
        },
      ],
    });
  });

  it("enforces exact contact or close perceptual matches and never returns raw thresholds", () => {
    const result = classifyDuplicateCandidates([
      {
        ...candidate,
        titleScore: 0.2,
        bodyScore: 0.3,
        imageDistance: 2,
        contactMatchCount: 1,
      },
    ]);

    expect(result).toMatchObject({
      enforcedCandidateCount: 1,
      candidates: [
        {
          mode: "ENFORCE",
          confidence: "HIGH",
          matchedSignals: ["IMAGE", "CONTACT"],
          imageDistance: 2,
          contactMatchCount: 1,
        },
      ],
    });
    expect(result.candidates[0]).not.toHaveProperty("thresholds");
  });
});
