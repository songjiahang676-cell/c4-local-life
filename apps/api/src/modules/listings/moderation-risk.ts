export const listingSubmissionRuleSet = {
  key: "listing-submission",
  version: 4,
} as const;

export const moderationRiskTiers = ["LOW", "MEDIUM", "HIGH"] as const;
export type ModerationRiskTier = (typeof moderationRiskTiers)[number];

export type ModerationRuleHit = {
  ruleCode:
    | "CATEGORY_MANUAL_REVIEW"
    | "EXTERNAL_CONTACT"
    | "EXTERNAL_PAYMENT_REQUEST"
    | "EMPLOYMENT_POLICY_RISK"
    | "NEW_ACCOUNT"
    | "POSSIBLE_DUPLICATE"
    | "PROHIBITED_GOODS_RISK"
    | "PUBLICATION_POLICY_INCOMPLETE";
  ruleVersion: 1;
  severity: Exclude<ModerationRiskTier, "LOW">;
  evidenceKey:
    "account_age" | "body" | "duplicate_candidates" | "publication_policy" | "summary" | "title";
};

export type ListingSubmissionRiskInput = {
  listingType?: "JOB" | "RENTAL" | "TRANSFER" | "SECONDHAND" | "SERVICE";
  title: string;
  summary: string | null;
  body: string;
  accountCreatedAt: Date;
  occurredAt: Date;
  publicationPolicy: {
    defaultLifetimeDays?: number;
    manualReviewRequired?: boolean;
  };
  enforcedDuplicateCandidateCount?: number;
};

export type ListingSubmissionRiskResult = {
  ruleSetKey: typeof listingSubmissionRuleSet.key;
  ruleSetVersion: typeof listingSubmissionRuleSet.version;
  riskTier: ModerationRiskTier;
  hits: readonly ModerationRuleHit[];
  defaultLifetimeDays: number | null;
};

const externalContactPattern =
  /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?1?[\s().-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{4})/iu;
const externalPaymentPattern =
  /(?:gift\s*cards?|wire\s+transfer|bitcoin|cryptocurrency|crypto\s+payment|zelle\s+(?:deposit|payment)|礼品卡|电汇|比特币|加密货币|先付(?:押金|定金)|平台外付款)/iu;
const employmentPolicyRiskPattern =
  /(?:women\s+only|men\s+only|female\s+only|male\s+only|young\s+(?:women|men|people)\s+only|under\s+\d{2}\s+only|仅限女性|仅限男性|只招女性|只招男性|只要年轻人|年轻漂亮)/iu;

const prohibitedGoodsPattern =
  /(?:\b(?:weapon|firearm|gun|drugs?|prescription\s+(?:drug|medicine)|counterfeit|stolen\s+(?:goods?|item)|hazardous\s+material)\b|武器|枪支|毒品|处方药|仿牌|赃物|危险品)/iu;

function textHit(
  input: ListingSubmissionRiskInput,
  pattern: RegExp,
): "body" | "summary" | "title" | null {
  if (pattern.test(input.title)) return "title";
  if (input.summary && pattern.test(input.summary)) return "summary";
  return pattern.test(input.body) ? "body" : null;
}

function highestTier(hits: readonly ModerationRuleHit[]): ModerationRiskTier {
  if (hits.some((hit) => hit.severity === "HIGH")) return "HIGH";
  return hits.length > 0 ? "MEDIUM" : "LOW";
}

export function evaluateListingSubmissionRisk(
  input: ListingSubmissionRiskInput,
): ListingSubmissionRiskResult {
  const hits: ModerationRuleHit[] = [];
  const accountAgeMs = input.occurredAt.getTime() - input.accountCreatedAt.getTime();
  if (!Number.isFinite(accountAgeMs) || accountAgeMs < 7 * 86_400_000) {
    hits.push({
      ruleCode: "NEW_ACCOUNT",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: "account_age",
    });
  }
  if (input.publicationPolicy.manualReviewRequired) {
    hits.push({
      ruleCode: "CATEGORY_MANUAL_REVIEW",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: "publication_policy",
    });
  }
  if ((input.enforcedDuplicateCandidateCount ?? 0) > 0) {
    hits.push({
      ruleCode: "POSSIBLE_DUPLICATE",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: "duplicate_candidates",
    });
  }
  const lifetimeDays = input.publicationPolicy.defaultLifetimeDays;
  if (!Number.isInteger(lifetimeDays) || (lifetimeDays ?? 0) < 1 || (lifetimeDays ?? 0) > 365) {
    hits.push({
      ruleCode: "PUBLICATION_POLICY_INCOMPLETE",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: "publication_policy",
    });
  }
  const contactEvidence = textHit(input, externalContactPattern);
  if (contactEvidence) {
    hits.push({
      ruleCode: "EXTERNAL_CONTACT",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: contactEvidence,
    });
  }
  const paymentEvidence = textHit(input, externalPaymentPattern);
  if (paymentEvidence) {
    hits.push({
      ruleCode: "EXTERNAL_PAYMENT_REQUEST",
      ruleVersion: 1,
      severity: "HIGH",
      evidenceKey: paymentEvidence,
    });
  }
  const employmentEvidence =
    input.listingType === "JOB" ? textHit(input, employmentPolicyRiskPattern) : null;
  if (employmentEvidence) {
    hits.push({
      ruleCode: "EMPLOYMENT_POLICY_RISK",
      ruleVersion: 1,
      severity: "MEDIUM",
      evidenceKey: employmentEvidence,
    });
  }
  const prohibitedGoodsEvidence =
    input.listingType === "SECONDHAND" ? textHit(input, prohibitedGoodsPattern) : null;
  if (prohibitedGoodsEvidence) {
    hits.push({
      ruleCode: "PROHIBITED_GOODS_RISK",
      ruleVersion: 1,
      severity: "HIGH",
      evidenceKey: prohibitedGoodsEvidence,
    });
  }
  return {
    ruleSetKey: listingSubmissionRuleSet.key,
    ruleSetVersion: listingSubmissionRuleSet.version,
    riskTier: highestTier(hits),
    hits,
    defaultLifetimeDays:
      Number.isInteger(lifetimeDays) && (lifetimeDays ?? 0) >= 1 && (lifetimeDays ?? 0) <= 365
        ? (lifetimeDays ?? null)
        : null,
  };
}
