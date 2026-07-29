import {
  ListingRevisionClassification,
  ModerationCaseStatus,
  type ModerationRiskTier,
  type Prisma,
  type ModerationStatus,
} from "../../generated/prisma/client";

export const listingRevisionReasonCodes = [
  "INITIAL_SUBMISSION",
  "RESUBMISSION",
  "TITLE_MATERIAL_CHANGE",
  "SUMMARY_MATERIAL_CHANGE",
  "BODY_MATERIAL_CHANGE",
  "CATEGORY_CHANGED",
  "REGION_CHANGED",
  "PRICE_CHANGED",
  "CONTACT_MODE_CHANGED",
  "LOCATION_CHANGED",
  "ATTRIBUTES_CHANGED",
  "MEDIA_CHANGED",
  "LOCALE_CHANGED",
  "MODERATION_RISK_SIGNAL",
  "MINOR_TEXT_EDIT",
] as const;

export type ListingRevisionReasonCode = (typeof listingRevisionReasonCodes)[number];
export type ListingRevisionReviewState =
  "NOT_REQUIRED" | "PENDING" | "ESCALATED" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export const listingRevisionDiffFields = [
  "locale",
  "title",
  "summary",
  "body",
  "price",
  "category",
  "region",
  "location",
  "contactMode",
  "attributes",
  "mediaIds",
] as const;

export type ListingRevisionDiffField = (typeof listingRevisionDiffFields)[number];
export type ListingRevisionDiffEntry = {
  field: ListingRevisionDiffField;
  kind: "ADDED" | "REMOVED" | "CHANGED";
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
};

export type ListingRevisionSnapshot = {
  locale: "zh-Hans" | "en-US";
  title: string;
  summary: string | null;
  body: string;
  price: { amount: string | null; currency: "USD"; unit: string } | null;
  category: { id: string; code: string; nameZhHans: string; nameEn: string };
  region: { id: string; code: string; nameZhHans: string; nameEn: string };
  location: { precision: "CITY" | "NEIGHBORHOOD" | "APPROXIMATE" | "EXACT" };
  contactMode: string;
  attributes: Record<string, Prisma.JsonValue>;
  mediaIds: string[];
  formSchemaVersion: number;
  defaultLifetimeDays: number;
};

export type ListingRevisionProjection = {
  id: string;
  revisionNumber: number;
  baseListingVersion: number;
  resultListingVersion: number;
  classification: ListingRevisionClassification;
  reasonCodes: ListingRevisionReasonCode[];
  reviewState: ListingRevisionReviewState;
  riskTier: ModerationRiskTier;
  ruleSetVersion: number;
  diff: ListingRevisionDiffEntry[];
  createdAt: Date;
};

export const listingRevisionSelect = {
  id: true,
  revisionNumber: true,
  baseListingVersion: true,
  resultListingVersion: true,
  classification: true,
  reasonCodes: true,
  riskTier: true,
  ruleSetVersion: true,
  diff: true,
  createdAt: true,
  evaluation: {
    select: {
      resultContentStatus: true,
      resultModerationStatus: true,
      moderationCase: {
        select: {
          status: true,
          actions: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { reasonCode: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ListingRevisionSelect;

export type SelectedListingRevision = Prisma.ListingRevisionGetPayload<{
  select: typeof listingRevisionSelect;
}>;

function isJsonValue(value: unknown): value is Prisma.JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue)
  );
}

function parseDiff(value: Prisma.JsonValue): ListingRevisionDiffEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("Listing revision diff evidence is invalid");
  }
  return value.map((entry) => {
    if (!entry || Array.isArray(entry) || typeof entry !== "object") {
      throw new Error("Listing revision diff evidence is invalid");
    }
    const field = entry.field;
    const kind = entry.kind;
    if (
      typeof field !== "string" ||
      !listingRevisionDiffFields.includes(field as ListingRevisionDiffField) ||
      (kind !== "ADDED" && kind !== "REMOVED" && kind !== "CHANGED") ||
      !("before" in entry) ||
      !("after" in entry) ||
      !isJsonValue(entry.before) ||
      !isJsonValue(entry.after)
    ) {
      throw new Error("Listing revision diff evidence is invalid");
    }
    return {
      field: field as ListingRevisionDiffField,
      kind,
      before: entry.before,
      after: entry.after,
    };
  });
}

function reviewState(input: {
  classification: ListingRevisionClassification;
  resultContentStatus: string | undefined;
  resultModerationStatus: ModerationStatus | undefined;
  caseStatus: ModerationCaseStatus | undefined;
  reasonCode: string | null | undefined;
}): ListingRevisionReviewState {
  if (input.classification === ListingRevisionClassification.MINOR_EDIT) return "NOT_REQUIRED";
  if (input.reasonCode === "CONTENT_POLICY_COMPLIANT") return "APPROVED";
  if (input.reasonCode === "NEEDS_CLARIFICATION") return "CHANGES_REQUESTED";
  if (input.reasonCode === "PROHIBITED_CONTENT" || input.reasonCode === "EXTERNAL_PAYMENT_RISK") {
    return "REJECTED";
  }
  if (input.resultContentStatus === "PUBLISHED" && input.resultModerationStatus === "APPROVED") {
    return "APPROVED";
  }
  if (
    input.resultModerationStatus === "ESCALATED" ||
    input.caseStatus === ModerationCaseStatus.ASSIGNED
  ) {
    return "ESCALATED";
  }
  return "PENDING";
}

export function mapListingRevision(row: SelectedListingRevision): ListingRevisionProjection {
  const reasonCodes = row.reasonCodes.map((reason) => {
    if (!listingRevisionReasonCodes.includes(reason as ListingRevisionReasonCode)) {
      throw new Error("Listing revision reason evidence is invalid");
    }
    return reason as ListingRevisionReasonCode;
  });
  if (reasonCodes.length === 0) throw new Error("Listing revision reason evidence is invalid");
  const moderationCase = row.evaluation?.moderationCase;
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    baseListingVersion: row.baseListingVersion,
    resultListingVersion: row.resultListingVersion,
    classification: row.classification,
    reasonCodes,
    reviewState: reviewState({
      classification: row.classification,
      resultContentStatus: row.evaluation?.resultContentStatus,
      resultModerationStatus: row.evaluation?.resultModerationStatus,
      caseStatus: moderationCase?.status,
      reasonCode: moderationCase?.actions[0]?.reasonCode,
    }),
    riskTier: row.riskTier,
    ruleSetVersion: row.ruleSetVersion,
    diff: parseDiff(row.diff),
    createdAt: row.createdAt,
  };
}
