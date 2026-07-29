import { createHmac } from "node:crypto";
import type {
  ListingDuplicateCandidateMatch,
  ModerationDuplicateCandidateInput,
} from "@socal/database/listing-submission";

export const listingDuplicatePolicy = {
  key: "listing-duplicate",
  version: 1,
  lookbackDays: 365,
  maximumCandidates: 10,
  thresholds: {
    titleCandidate: 0.62,
    titleEnforce: 0.9,
    bodyCandidate: 0.72,
    bodyEnforce: 0.92,
    imageCandidateDistance: 10,
    imageEnforceDistance: 4,
  },
} as const;

type ContactField = {
  key: string;
  type: "EMAIL" | "PHONE";
};

function contactFields(definition: unknown): ContactField[] {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return [];
  const fields = (definition as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return [];
    const candidate = field as Record<string, unknown>;
    if (
      typeof candidate.key !== "string" ||
      (candidate.type !== "EMAIL" && candidate.type !== "PHONE")
    ) {
      return [];
    }
    return [{ key: candidate.key, type: candidate.type }];
  });
}

function normalizeContact(type: ContactField["type"], value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (type === "EMAIL") {
    return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(normalized) ? normalized : null;
  }
  const digits = normalized.replace(/\D/gu, "");
  if (digits.length === 10) return `1${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function contactFingerprints(input: {
  attributes: unknown;
  formSchemaDefinition: unknown;
  secret: string;
}): string[] {
  if (
    !input.attributes ||
    typeof input.attributes !== "object" ||
    Array.isArray(input.attributes)
  ) {
    return [];
  }
  const attributes = input.attributes as Record<string, unknown>;
  const fingerprints = contactFields(input.formSchemaDefinition).flatMap((field) => {
    const normalized = normalizeContact(field.type, attributes[field.key]);
    if (!normalized) return [];
    return [
      createHmac("sha256", input.secret)
        .update("socal-listing-contact-fingerprint-v1\0", "utf8")
        .update(field.type, "utf8")
        .update("\0", "utf8")
        .update(normalized, "utf8")
        .digest("hex"),
    ];
  });
  return [...new Set(fingerprints)].sort();
}

function boundedScore(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function classifyDuplicateCandidates(matches: readonly ListingDuplicateCandidateMatch[]): {
  candidates: ModerationDuplicateCandidateInput[];
  enforcedCandidateCount: number;
} {
  const candidates = matches.flatMap((match): ModerationDuplicateCandidateInput[] => {
    const titleScore = boundedScore(match.titleScore);
    const bodyScore = boundedScore(match.bodyScore);
    const textMatched =
      titleScore >= listingDuplicatePolicy.thresholds.titleCandidate ||
      bodyScore >= listingDuplicatePolicy.thresholds.bodyCandidate;
    const imageMatched =
      match.imageDistance !== null &&
      match.imageDistance <= listingDuplicatePolicy.thresholds.imageCandidateDistance;
    const contactMatched = match.contactMatchCount > 0;
    const matchedSignals = [
      ...(textMatched ? (["TEXT"] as const) : []),
      ...(imageMatched ? (["IMAGE"] as const) : []),
      ...(contactMatched ? (["CONTACT"] as const) : []),
    ];
    if (matchedSignals.length === 0) return [];

    const enforced =
      titleScore >= listingDuplicatePolicy.thresholds.titleEnforce ||
      bodyScore >= listingDuplicatePolicy.thresholds.bodyEnforce ||
      (match.imageDistance !== null &&
        match.imageDistance <= listingDuplicatePolicy.thresholds.imageEnforceDistance) ||
      contactMatched;
    const highConfidence =
      contactMatched ||
      (match.imageDistance !== null && match.imageDistance <= 2) ||
      titleScore >= 0.96 ||
      bodyScore >= 0.97 ||
      matchedSignals.length >= 2;
    return [
      {
        candidateListingId: match.listingId,
        candidateListingVersion: match.listingVersion,
        candidateType: match.listingType,
        candidateTitle: match.title,
        candidateStatus: match.status,
        thresholdVersion: listingDuplicatePolicy.version,
        mode: enforced ? "ENFORCE" : "DRY_RUN",
        confidence: highConfidence ? "HIGH" : "MEDIUM",
        matchedSignals,
        titleScore: textMatched ? titleScore : null,
        bodyScore: textMatched ? bodyScore : null,
        imageDistance: imageMatched ? match.imageDistance : null,
        contactMatchCount: contactMatched ? Math.min(20, match.contactMatchCount) : 0,
      },
    ];
  });
  return {
    candidates,
    enforcedCandidateCount: candidates.filter((candidate) => candidate.mode === "ENFORCE").length,
  };
}
