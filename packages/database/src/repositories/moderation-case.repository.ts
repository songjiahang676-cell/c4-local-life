import { PrismaPg } from "@prisma/adapter-pg";
import {
  AuthenticationStrength,
  ContentStatus,
  MediaStatus,
  ModerationCaseStatus,
  ModerationStatus,
  PlatformRole,
  Prisma,
  PrismaClient,
  UserStatus,
  type ContactMode,
  type ListingType,
  type ModerationRiskTier,
  type PriceUnit,
} from "../../generated/prisma/client";
import { listingRevisionReasonCodes, type ListingRevisionReasonCode } from "./listing-revision";

export type ModerationCaseRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ModerationActionKind = "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "ESCALATE";
export type ModerationReasonCode =
  | "CONTENT_POLICY_COMPLIANT"
  | "DUPLICATE_CONTENT"
  | "NEEDS_CLARIFICATION"
  | "PROHIBITED_CONTENT"
  | "EXTERNAL_PAYMENT_RISK"
  | "ESCALATE_SENIOR_REVIEW";

export type ModerationCaseCursor = {
  priority: number;
  createdAt: Date;
  id: string;
};

export type ModerationSnapshotReference = {
  id: string;
  code: string;
  nameZhHans: string;
  nameEn: string;
};

export type ModerationListingSnapshot = {
  listingId: string;
  listingVersion: number;
  type: ListingType;
  locale: "zh-Hans" | "en-US";
  title: string;
  summary: string | null;
  body: string;
  price: { amount: string | null; currency: "USD"; unit: PriceUnit } | null;
  attributes: Record<string, unknown>;
  contactMode: ContactMode;
  locationPrecision: "CITY" | "NEIGHBORHOOD" | "APPROXIMATE" | "EXACT";
  mediaIds: string[];
  category: ModerationSnapshotReference;
  region: ModerationSnapshotReference;
  formSchemaVersion: number;
  defaultLifetimeDays: number;
  sensitiveFieldsRedacted: true;
  capturedAt: string;
  previous: Record<string, unknown> | null;
  revision: {
    id: string;
    classification: "SUBMISSION" | "MINOR_EDIT" | "MAJOR_EDIT";
    reasonCodes: ListingRevisionReasonCode[];
    originalPublishedAt: string | null;
    originalExpiresAt: string | null;
  } | null;
};

export type ModerationCaseListItem = {
  id: string;
  targetType: "LISTING";
  targetId: string;
  queue: "listing-submission";
  priority: number;
  riskTier: Exclude<ModerationRiskTier, "LOW">;
  status: ModerationCaseStatus;
  version: number;
  listing: {
    id: string;
    type: ListingType;
    locale: "zh-Hans" | "en-US";
    title: string;
    category: ModerationSnapshotReference;
    region: ModerationSnapshotReference;
  };
  ruleCodes: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type ModerationRuleEvidence = {
  ruleCode: string;
  ruleVersion: number;
  severity: Exclude<ModerationRiskTier, "LOW">;
  evidenceKey: string;
};

export type ModerationMediaEvidence = {
  mediaId: string;
  status: Exclude<MediaStatus, "DELETED">;
  rejectionCode: string | null;
  updatedAt: Date;
};

export type ModerationPublisherHistory = {
  accountAgeDays: number;
  submittedCount: number;
  publishedCount: number;
  rejectedCount: number;
  suspendedCount: number;
};

export type ModerationDuplicateEvidence = {
  candidateListingId: string;
  candidateListingVersion: number;
  candidateType: ListingType;
  candidateTitle: string;
  candidateStatus: ContentStatus;
  thresholdVersion: number;
  mode: "DRY_RUN" | "ENFORCE";
  confidence: "MEDIUM" | "HIGH";
  matchedSignals: ("TEXT" | "IMAGE" | "CONTACT")[];
};

export type ModerationListingAggregateProjection = {
  id: string;
  type: ListingType;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  detail:
    | {
        kind: "JOB";
        wageMinMinor: bigint | null;
        wageMaxMinor: bigint | null;
        wageUnit: PriceUnit | null;
      }
    | {
        kind: "RENTAL";
        bedrooms: number | null;
        bathrooms: number | null;
        depositMinor: bigint | null;
      }
    | {
        kind: "TRANSFER";
        askingPriceMinor: bigint | null;
        monthlyRentMinor: bigint | null;
        leaseRemainingMonths: number | null;
      }
    | { kind: "SECONDHAND"; condition: string | null }
    | { kind: "SERVICE"; serviceRadiusMiles: number | null };
  price: { amountMinor: bigint | null; currency: "USD"; unit: PriceUnit } | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type ModerationCaseDetail = {
  item: ModerationCaseListItem;
  snapshot: ModerationListingSnapshot;
  rules: ModerationRuleEvidence[];
  media: ModerationMediaEvidence[];
  publisherHistory: ModerationPublisherHistory;
  duplicateCandidates: ModerationDuplicateEvidence[];
  listing: ModerationListingAggregateProjection;
};

export type ListModerationCasesInput = {
  actorUserId: string;
  sessionId: string;
  queue: "listing-submission";
  status: ModerationCaseStatus;
  riskTier?: Exclude<ModerationRiskTier, "LOW">;
  minPriority?: number;
  cursor?: ModerationCaseCursor;
  limit: number;
  now: Date;
};

export type ListModerationCasesResult =
  | {
      kind: "listed";
      items: ModerationCaseListItem[];
      nextCursor: ModerationCaseCursor | null;
    }
  | { kind: "actor_unavailable" };

export type GetModerationCaseInput = {
  actorUserId: string;
  sessionId: string;
  caseId: string;
  now: Date;
};

export type GetModerationCaseResult =
  { kind: "found"; detail: ModerationCaseDetail } | { kind: "actor_unavailable" | "not_found" };

export type ModerationActionProjection = {
  caseId: string;
  actionId: string;
  action: ModerationActionKind;
  reasonCode: ModerationReasonCode;
  previousCaseStatus: ModerationCaseStatus;
  currentCaseStatus: ModerationCaseStatus;
  previousContentStatus: ContentStatus;
  currentContentStatus: ContentStatus;
  previousModerationStatus: ModerationStatus;
  currentModerationStatus: ModerationStatus;
  caseVersion: number;
  listingVersion: number;
  occurredAt: Date;
};

export type CommitModerationActionInput = {
  actorUserId: string;
  sessionId: string;
  recentMfaAfter: Date;
  caseId: string;
  expectedCaseVersion: number;
  expectedListingVersion: number;
  action: ModerationActionKind;
  reasonCode: ModerationReasonCode;
  note?: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
  nextListing: {
    status: ContentStatus;
    moderationStatus: ModerationStatus;
    publishedAt: Date | null;
    expiresAt: Date | null;
    version: number;
  };
};

export type CommitModerationActionResult =
  | {
      kind: "committed";
      action: ModerationActionProjection;
      duplicateReview: {
        outcome: "CONFIRMED" | "FALSE_POSITIVE";
        candidateCount: number;
      } | null;
    }
  | {
      kind: "exact_retry";
      action: ModerationActionProjection;
    }
  | {
      kind:
        | "actor_unavailable"
        | "idempotency_conflict"
        | "not_found"
        | "state_conflict"
        | "time_conflict"
        | "version_conflict";
      currentCaseVersion?: number;
    };

type ModerationClient = PrismaClient | Prisma.TransactionClient;

const moderatorRoles = [PlatformRole.MODERATOR, PlatformRole.SENIOR_MODERATOR] as const;
const reasonByAction: Readonly<Record<ModerationActionKind, readonly ModerationReasonCode[]>> = {
  APPROVE: ["CONTENT_POLICY_COMPLIANT"],
  REQUEST_CHANGES: ["NEEDS_CLARIFICATION", "DUPLICATE_CONTENT"],
  REJECT: ["PROHIBITED_CONTENT", "EXTERNAL_PAYMENT_RISK", "DUPLICATE_CONTENT"],
  ESCALATE: ["ESCALATE_SENIOR_REVIEW"],
};

function isRepositoryOptions(
  target: ModerationClient | ModerationCaseRepositoryOptions,
): target is ModerationCaseRepositoryOptions {
  return "connectionString" in target;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isReference(value: unknown): value is ModerationSnapshotReference {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.code === "string" &&
    typeof value.nameZhHans === "string" &&
    typeof value.nameEn === "string"
  );
}

function isListingType(value: unknown): value is ListingType {
  return (
    typeof value === "string" &&
    ["JOB", "RENTAL", "TRANSFER", "SECONDHAND", "SERVICE"].includes(value)
  );
}

function isLocale(value: unknown): value is "zh-Hans" | "en-US" {
  return value === "zh-Hans" || value === "en-US";
}

function isContactMode(value: unknown): value is ContactMode {
  return value === "IN_APP" || value === "PHONE_REVEAL" || value === "EMAIL_REVEAL";
}

function isLocationPrecision(
  value: unknown,
): value is ModerationListingSnapshot["locationPrecision"] {
  return (
    value === "CITY" || value === "NEIGHBORHOOD" || value === "APPROXIMATE" || value === "EXACT"
  );
}

function isPriceUnit(value: unknown): value is PriceUnit {
  return (
    typeof value === "string" &&
    [
      "FIXED",
      "HOURLY",
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "YEARLY",
      "SQFT",
      "NEGOTIABLE",
      "FREE",
    ].includes(value)
  );
}

function isListingRevisionClassification(
  value: unknown,
): value is "SUBMISSION" | "MINOR_EDIT" | "MAJOR_EDIT" {
  return value === "SUBMISSION" || value === "MINOR_EDIT" || value === "MAJOR_EDIT";
}

function isListingRevisionReasonCode(value: unknown): value is ListingRevisionReasonCode {
  return (
    typeof value === "string" &&
    listingRevisionReasonCodes.some((reasonCode) => reasonCode === value)
  );
}

function parseSnapshot(value: Prisma.JsonValue): ModerationListingSnapshot | null {
  if (
    !isObject(value) ||
    typeof value.listingId !== "string" ||
    typeof value.listingVersion !== "number" ||
    !isListingType(value.type) ||
    !isLocale(value.locale) ||
    typeof value.title !== "string" ||
    (value.summary !== null && typeof value.summary !== "string") ||
    typeof value.body !== "string" ||
    !isObject(value.attributes) ||
    !isContactMode(value.contactMode) ||
    !isLocationPrecision(value.locationPrecision) ||
    !Array.isArray(value.mediaIds) ||
    !value.mediaIds.every((id) => typeof id === "string") ||
    !isReference(value.category) ||
    !isReference(value.region) ||
    typeof value.formSchemaVersion !== "number" ||
    typeof value.defaultLifetimeDays !== "number" ||
    value.sensitiveFieldsRedacted !== true ||
    typeof value.capturedAt !== "string"
  ) {
    return null;
  }
  const price: ModerationListingSnapshot["price"] | undefined =
    value.price === null
      ? null
      : isObject(value.price) &&
          (value.price.amount === null || typeof value.price.amount === "string") &&
          value.price.currency === "USD" &&
          isPriceUnit(value.price.unit)
        ? {
            amount: value.price.amount,
            currency: "USD",
            unit: value.price.unit,
          }
        : undefined;
  if (price === undefined) return null;
  const previous =
    value.previous === undefined || value.previous === null
      ? null
      : isObject(value.previous)
        ? value.previous
        : undefined;
  if (previous === undefined) return null;
  const revisionValue = value.revision;
  const revision =
    revisionValue === undefined || revisionValue === null
      ? null
      : isObject(revisionValue) &&
          typeof revisionValue.id === "string" &&
          isListingRevisionClassification(revisionValue.classification) &&
          Array.isArray(revisionValue.reasonCodes) &&
          revisionValue.reasonCodes.every(isListingRevisionReasonCode) &&
          (revisionValue.originalPublishedAt === undefined ||
            revisionValue.originalPublishedAt === null ||
            typeof revisionValue.originalPublishedAt === "string") &&
          (revisionValue.originalExpiresAt === undefined ||
            revisionValue.originalExpiresAt === null ||
            typeof revisionValue.originalExpiresAt === "string")
        ? {
            id: revisionValue.id,
            classification: revisionValue.classification,
            reasonCodes: [...revisionValue.reasonCodes],
            originalPublishedAt:
              typeof revisionValue.originalPublishedAt === "string"
                ? revisionValue.originalPublishedAt
                : null,
            originalExpiresAt:
              typeof revisionValue.originalExpiresAt === "string"
                ? revisionValue.originalExpiresAt
                : null,
          }
        : undefined;
  if (revision === undefined) return null;
  return {
    listingId: value.listingId,
    listingVersion: value.listingVersion,
    type: value.type,
    locale: value.locale,
    title: value.title,
    summary: value.summary,
    body: value.body,
    price,
    attributes: value.attributes,
    contactMode: value.contactMode,
    locationPrecision: value.locationPrecision,
    mediaIds: [...value.mediaIds],
    category: value.category,
    region: value.region,
    formSchemaVersion: value.formSchemaVersion,
    defaultLifetimeDays: value.defaultLifetimeDays,
    sensitiveFieldsRedacted: true,
    capturedAt: value.capturedAt,
    previous,
    revision,
  };
}

function toMinorUnits(value: Prisma.Decimal | null): bigint | null {
  return value === null ? null : BigInt(value.mul(100).toFixed(0));
}

function mapListingAggregate(row: {
  id: string;
  type: ListingType;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  priceAmount: Prisma.Decimal | null;
  currency: string;
  priceUnit: PriceUnit | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  jobDetail: {
    wageMin: Prisma.Decimal | null;
    wageMax: Prisma.Decimal | null;
    wageUnit: PriceUnit | null;
  } | null;
  rentalDetail: {
    bedrooms: Prisma.Decimal | null;
    bathrooms: Prisma.Decimal | null;
    depositAmount: Prisma.Decimal | null;
  } | null;
  transferDetail: {
    askingPrice: Prisma.Decimal | null;
    monthlyRent: Prisma.Decimal | null;
    leaseRemainingMonths: number | null;
  } | null;
  secondhandDetail: { condition: string | null } | null;
  serviceDetail: { serviceRadiusMiles: number | null } | null;
}): ModerationListingAggregateProjection | null {
  let detail: ModerationListingAggregateProjection["detail"];
  switch (row.type) {
    case "JOB":
      if (!row.jobDetail) return null;
      detail = {
        kind: "JOB",
        wageMinMinor: toMinorUnits(row.jobDetail.wageMin),
        wageMaxMinor: toMinorUnits(row.jobDetail.wageMax),
        wageUnit: row.jobDetail.wageUnit,
      };
      break;
    case "RENTAL":
      if (!row.rentalDetail) return null;
      detail = {
        kind: "RENTAL",
        bedrooms: row.rentalDetail.bedrooms?.toNumber() ?? null,
        bathrooms: row.rentalDetail.bathrooms?.toNumber() ?? null,
        depositMinor: toMinorUnits(row.rentalDetail.depositAmount),
      };
      break;
    case "TRANSFER":
      if (!row.transferDetail) return null;
      detail = {
        kind: "TRANSFER",
        askingPriceMinor: toMinorUnits(row.transferDetail.askingPrice),
        monthlyRentMinor: toMinorUnits(row.transferDetail.monthlyRent),
        leaseRemainingMonths: row.transferDetail.leaseRemainingMonths,
      };
      break;
    case "SECONDHAND":
      if (!row.secondhandDetail) return null;
      detail = { kind: "SECONDHAND", condition: row.secondhandDetail.condition };
      break;
    case "SERVICE":
      if (!row.serviceDetail) return null;
      detail = { kind: "SERVICE", serviceRadiusMiles: row.serviceDetail.serviceRadiusMiles };
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    moderationStatus: row.moderationStatus,
    detail,
    price:
      row.priceUnit === null
        ? null
        : {
            amountMinor: toMinorUnits(row.priceAmount),
            currency: "USD",
            unit: row.priceUnit,
          },
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

async function validModeratorSession(
  client: ModerationClient,
  input: {
    actorUserId: string;
    sessionId: string;
    now: Date;
    recentMfaAfter?: Date;
  },
): Promise<boolean> {
  const session = await client.authSession.findFirst({
    where: {
      id: input.sessionId,
      userId: input.actorUserId,
      authenticationStrength: AuthenticationStrength.MFA,
      mfaVerifiedAt: input.recentMfaAfter ? { gte: input.recentMfaAfter } : { not: null },
      revokedAt: null,
      expiresAt: { gt: input.now },
      idleExpiresAt: { gt: input.now },
      user: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        platformRoles: {
          some: {
            role: { in: [...moderatorRoles] },
            grantedAt: { lte: input.now },
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
          },
        },
      },
    },
    select: { id: true },
  });
  return session !== null;
}

function listItemFromRow(row: {
  id: string;
  targetId: string;
  priority: number;
  status: ModerationCaseStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  evaluation: {
    riskTier: ModerationRiskTier;
    ruleHits: { ruleCode: string }[];
  } | null;
  snapshot: { snapshot: Prisma.JsonValue } | null;
}): ModerationCaseListItem | null {
  const snapshot = row.snapshot ? parseSnapshot(row.snapshot.snapshot) : null;
  if (!snapshot || !row.evaluation || row.evaluation.riskTier === "LOW") return null;
  return {
    id: row.id,
    targetType: "LISTING",
    targetId: row.targetId,
    queue: "listing-submission",
    priority: row.priority,
    riskTier: row.evaluation.riskTier,
    status: row.status,
    version: row.version,
    listing: {
      id: snapshot.listingId,
      type: snapshot.type,
      locale: snapshot.locale,
      title: snapshot.title,
      category: snapshot.category,
      region: snapshot.region,
    },
    ruleCodes: row.evaluation.ruleHits.map((hit) => hit.ruleCode).sort(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actionProjectionFromMetadata(action: {
  id: string;
  caseId: string;
  action: string;
  reasonCode: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): ModerationActionProjection | null {
  const metadata = action.metadata;
  if (
    !isObject(metadata) ||
    !["APPROVE", "REQUEST_CHANGES", "REJECT", "ESCALATE"].includes(action.action) ||
    typeof action.reasonCode !== "string" ||
    !Object.values(reasonByAction)
      .flat()
      .includes(action.reasonCode as ModerationReasonCode) ||
    typeof metadata.previousCaseStatus !== "string" ||
    typeof metadata.currentCaseStatus !== "string" ||
    typeof metadata.previousContentStatus !== "string" ||
    typeof metadata.currentContentStatus !== "string" ||
    typeof metadata.previousModerationStatus !== "string" ||
    typeof metadata.currentModerationStatus !== "string" ||
    typeof metadata.caseVersion !== "number" ||
    typeof metadata.listingVersion !== "number"
  ) {
    return null;
  }
  return {
    caseId: action.caseId,
    actionId: action.id,
    action: action.action as ModerationActionKind,
    reasonCode: action.reasonCode as ModerationReasonCode,
    previousCaseStatus: metadata.previousCaseStatus as ModerationCaseStatus,
    currentCaseStatus: metadata.currentCaseStatus as ModerationCaseStatus,
    previousContentStatus: metadata.previousContentStatus as ContentStatus,
    currentContentStatus: metadata.currentContentStatus as ContentStatus,
    previousModerationStatus: metadata.previousModerationStatus as ModerationStatus,
    currentModerationStatus: metadata.currentModerationStatus as ModerationStatus,
    caseVersion: metadata.caseVersion,
    listingVersion: metadata.listingVersion,
    occurredAt: action.createdAt,
  };
}

async function lockIdempotencyKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${"moderation-action-v1"} || ':' || ${actorUserId} || ':' || ${idempotencyKey}, 0)
    )`,
  );
}

async function lockRow(
  transaction: Prisma.TransactionClient,
  table: "moderation_cases" | "listings",
  id: string,
): Promise<boolean> {
  const rows =
    table === "moderation_cases"
      ? await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "moderation_cases" WHERE "id" = ${id}::uuid FOR UPDATE`,
        )
      : await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "listings" WHERE "id" = ${id}::uuid FOR UPDATE`,
        );
  return rows.length === 1;
}

export class ModerationCaseRepository {
  readonly #client: ModerationClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ModerationClient | ModerationCaseRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  async list(input: ListModerationCasesInput): Promise<ListModerationCasesResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const rows = await this.#client.moderationCase.findMany({
      where: {
        targetType: "LISTING",
        queue: input.queue,
        status: input.status,
        ...(input.minPriority === undefined ? {} : { priority: { gte: input.minPriority } }),
        ...(input.riskTier === undefined
          ? {}
          : { evaluation: { is: { riskTier: input.riskTier } } }),
        snapshot: { isNot: null },
        ...(input.cursor
          ? {
              OR: [
                { priority: { lt: input.cursor.priority } },
                {
                  priority: input.cursor.priority,
                  createdAt: { gt: input.cursor.createdAt },
                },
                {
                  priority: input.cursor.priority,
                  createdAt: input.cursor.createdAt,
                  id: { gt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        targetId: true,
        priority: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        evaluation: {
          select: {
            riskTier: true,
            ruleHits: { select: { ruleCode: true } },
          },
        },
        snapshot: { select: { snapshot: true } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });
    const mapped = rows.map(listItemFromRow).filter((item) => item !== null);
    const hasMore = mapped.length > input.limit;
    const items = mapped.slice(0, input.limit);
    const last = items.at(-1);
    return {
      kind: "listed",
      items,
      nextCursor:
        hasMore && last
          ? { priority: last.priority, createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  async get(input: GetModerationCaseInput): Promise<GetModerationCaseResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const row = await this.#client.moderationCase.findFirst({
      where: {
        id: input.caseId,
        targetType: "LISTING",
        queue: "listing-submission",
        snapshot: { isNot: null },
      },
      select: {
        id: true,
        targetId: true,
        priority: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        evaluation: {
          select: {
            riskTier: true,
            actor: { select: { createdAt: true } },
            ruleHits: {
              select: {
                ruleCode: true,
                ruleVersion: true,
                severity: true,
                evidenceKey: true,
              },
              orderBy: { ruleCode: "asc" },
            },
            duplicateCandidates: {
              select: {
                candidateListingId: true,
                candidateListingVersion: true,
                candidateType: true,
                candidateTitle: true,
                candidateStatus: true,
                thresholdVersion: true,
                mode: true,
                confidence: true,
                matchedSignals: true,
              },
              orderBy: [{ mode: "desc" }, { confidence: "asc" }, { candidateListingId: "asc" }],
              take: 10,
            },
          },
        },
        snapshot: { select: { snapshot: true } },
      },
    });
    if (!row) return { kind: "not_found" };
    const item = listItemFromRow(row);
    const snapshot = row.snapshot ? parseSnapshot(row.snapshot.snapshot) : null;
    if (!item || !snapshot || !row.evaluation) return { kind: "not_found" };

    const listing = await this.#client.listing.findFirst({
      where: { id: row.targetId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        type: true,
        status: true,
        moderationStatus: true,
        priceAmount: true,
        currency: true,
        priceUnit: true,
        publishedAt: true,
        expiresAt: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        jobDetail: { select: { wageMin: true, wageMax: true, wageUnit: true } },
        rentalDetail: { select: { bedrooms: true, bathrooms: true, depositAmount: true } },
        transferDetail: {
          select: { askingPrice: true, monthlyRent: true, leaseRemainingMonths: true },
        },
        secondhandDetail: { select: { condition: true } },
        serviceDetail: { select: { serviceRadiusMiles: true } },
        uploadedMedia: {
          where: { status: { not: MediaStatus.DELETED } },
          select: { id: true, status: true, rejectionCode: true, updatedAt: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!listing) return { kind: "not_found" };
    const aggregate = mapListingAggregate(listing);
    if (!aggregate) return { kind: "not_found" };
    const [submittedCount, publishedCount, rejectedCount, suspendedCount] = await Promise.all([
      this.#client.listing.count({
        where: {
          ownerId: listing.ownerId,
          status: {
            in: [ContentStatus.SUBMITTED, ContentStatus.PUBLISHED, ContentStatus.SUSPENDED],
          },
        },
      }),
      this.#client.listing.count({
        where: { ownerId: listing.ownerId, status: ContentStatus.PUBLISHED },
      }),
      this.#client.listing.count({
        where: { ownerId: listing.ownerId, moderationStatus: ModerationStatus.REJECTED },
      }),
      this.#client.listing.count({
        where: { ownerId: listing.ownerId, status: ContentStatus.SUSPENDED },
      }),
    ]);
    return {
      kind: "found",
      detail: {
        item,
        snapshot,
        rules: row.evaluation.ruleHits
          .filter((hit) => hit.severity !== "LOW")
          .map((hit) => ({
            ruleCode: hit.ruleCode,
            ruleVersion: hit.ruleVersion,
            severity: hit.severity as Exclude<ModerationRiskTier, "LOW">,
            evidenceKey: hit.evidenceKey,
          })),
        media: listing.uploadedMedia.map((media) => ({
          mediaId: media.id,
          status: media.status as Exclude<MediaStatus, "DELETED">,
          rejectionCode: media.rejectionCode,
          updatedAt: media.updatedAt,
        })),
        publisherHistory: {
          accountAgeDays: Math.max(
            0,
            Math.floor(
              (row.createdAt.getTime() - row.evaluation.actor.createdAt.getTime()) / 86_400_000,
            ),
          ),
          submittedCount,
          publishedCount,
          rejectedCount,
          suspendedCount,
        },
        duplicateCandidates: row.evaluation.duplicateCandidates.flatMap((candidate) => {
          if (
            (candidate.mode !== "DRY_RUN" && candidate.mode !== "ENFORCE") ||
            (candidate.confidence !== "MEDIUM" && candidate.confidence !== "HIGH") ||
            candidate.matchedSignals.some(
              (signal) => signal !== "TEXT" && signal !== "IMAGE" && signal !== "CONTACT",
            )
          ) {
            return [];
          }
          return [
            {
              candidateListingId: candidate.candidateListingId,
              candidateListingVersion: candidate.candidateListingVersion,
              candidateType: candidate.candidateType,
              candidateTitle: candidate.candidateTitle,
              candidateStatus: candidate.candidateStatus,
              thresholdVersion: candidate.thresholdVersion,
              mode: candidate.mode,
              confidence: candidate.confidence,
              matchedSignals: candidate.matchedSignals as ("TEXT" | "IMAGE" | "CONTACT")[],
            },
          ];
        }),
        listing: aggregate,
      },
    };
  }

  commit(input: CommitModerationActionInput): Promise<CommitModerationActionResult> {
    return this.#inTransaction(async (transaction) => {
      await lockIdempotencyKey(transaction, input.actorUserId, input.idempotencyKey);
      if (
        !(await validModeratorSession(transaction, {
          actorUserId: input.actorUserId,
          sessionId: input.sessionId,
          now: input.occurredAt,
          recentMfaAfter: input.recentMfaAfter,
        }))
      ) {
        return { kind: "actor_unavailable" };
      }
      const prior = await transaction.moderationAction.findUnique({
        where: {
          actorId_idempotencyKey: {
            actorId: input.actorUserId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          id: true,
          caseId: true,
          action: true,
          reasonCode: true,
          requestHash: true,
          metadata: true,
          createdAt: true,
        },
      });
      if (prior) {
        if (prior.requestHash !== input.requestHash) return { kind: "idempotency_conflict" };
        const projection = actionProjectionFromMetadata(prior);
        return projection
          ? { kind: "exact_retry", action: projection }
          : { kind: "state_conflict" };
      }
      if (!(await lockRow(transaction, "moderation_cases", input.caseId))) {
        return { kind: "not_found" };
      }
      const currentCase = await transaction.moderationCase.findFirst({
        where: {
          id: input.caseId,
          targetType: "LISTING",
          queue: "listing-submission",
        },
        select: {
          id: true,
          targetId: true,
          status: true,
          priority: true,
          version: true,
          updatedAt: true,
          evaluation: {
            select: {
              id: true,
              duplicateCandidates: {
                where: { reviewOutcome: "UNREVIEWED" },
                select: { id: true },
              },
              listingRevision: {
                select: {
                  classification: true,
                  originalPublishedAt: true,
                  originalExpiresAt: true,
                },
              },
            },
          },
        },
      });
      if (!currentCase) return { kind: "not_found" };
      if (currentCase.version !== input.expectedCaseVersion) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        currentCase.status !== ModerationCaseStatus.OPEN &&
        currentCase.status !== ModerationCaseStatus.ASSIGNED
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (!(await lockRow(transaction, "listings", currentCase.targetId))) {
        return { kind: "not_found" };
      }
      const listing = await transaction.listing.findFirst({
        where: { id: currentCase.targetId, deletedAt: null },
        select: {
          type: true,
          status: true,
          moderationStatus: true,
          version: true,
          updatedAt: true,
        },
      });
      if (!listing) return { kind: "not_found" };
      if (
        listing.version !== input.expectedListingVersion ||
        input.nextListing.version !== listing.version + 1
      ) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        listing.status !== ContentStatus.SUBMITTED ||
        (listing.moderationStatus !== ModerationStatus.PENDING_REVIEW &&
          listing.moderationStatus !== ModerationStatus.ESCALATED) ||
        !reasonByAction[input.action].includes(input.reasonCode)
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (input.occurredAt < listing.updatedAt || input.occurredAt < currentCase.updatedAt) {
        return { kind: "time_conflict", currentCaseVersion: currentCase.version };
      }
      const revision = currentCase.evaluation?.listingRevision;
      const revisionPublishedAt =
        revision?.classification === "MAJOR_EDIT" ? revision.originalPublishedAt : null;
      const revisionExpiresAt =
        revision?.classification === "MAJOR_EDIT" ? revision.originalExpiresAt : null;
      const revisionApproval =
        input.action === "APPROVE" && revisionPublishedAt !== null && revisionExpiresAt !== null;
      const expectedOutcome =
        input.action === "APPROVE"
          ? [
              revisionApproval && input.occurredAt >= revisionExpiresAt
                ? ContentStatus.EXPIRED
                : ContentStatus.PUBLISHED,
              ModerationStatus.APPROVED,
            ]
          : input.action === "REQUEST_CHANGES"
            ? [ContentStatus.DRAFT, ModerationStatus.REJECTED]
            : input.action === "REJECT"
              ? [ContentStatus.SUSPENDED, ModerationStatus.REJECTED]
              : [ContentStatus.SUBMITTED, ModerationStatus.ESCALATED];
      if (
        input.nextListing.status !== expectedOutcome[0] ||
        input.nextListing.moderationStatus !== expectedOutcome[1]
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        revisionApproval &&
        (input.nextListing.publishedAt?.getTime() !== revisionPublishedAt.getTime() ||
          input.nextListing.expiresAt?.getTime() !== revisionExpiresAt.getTime())
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }

      const changedListing = await transaction.listing.updateMany({
        where: {
          id: currentCase.targetId,
          version: listing.version,
          status: listing.status,
          moderationStatus: listing.moderationStatus,
          deletedAt: null,
        },
        data: {
          status: input.nextListing.status,
          moderationStatus: input.nextListing.moderationStatus,
          publishedAt: input.nextListing.publishedAt,
          expiresAt: input.nextListing.expiresAt,
          updatedAt: input.occurredAt,
          version: input.nextListing.version,
        },
      });
      if (changedListing.count !== 1) {
        throw new Error("Locked Listing changed during moderation action");
      }

      const nextCaseStatus =
        input.action === "ESCALATE" ? ModerationCaseStatus.OPEN : ModerationCaseStatus.RESOLVED;
      const nextCaseVersion = currentCase.version + 1;
      const changedCase = await transaction.moderationCase.updateMany({
        where: {
          id: currentCase.id,
          version: currentCase.version,
          status: currentCase.status,
        },
        data: {
          status: nextCaseStatus,
          priority: input.action === "ESCALATE" ? Math.max(currentCase.priority, 80) : undefined,
          assignedToId: input.actorUserId,
          decisionCode: input.action === "ESCALATE" ? null : input.reasonCode,
          resolutionNote: input.action === "ESCALATE" ? null : (input.note ?? null),
          resolvedAt: input.action === "ESCALATE" ? null : input.occurredAt,
          updatedAt: input.occurredAt,
          version: nextCaseVersion,
        },
      });
      if (changedCase.count !== 1) {
        throw new Error("Locked moderation case changed during action");
      }

      const duplicateReviewOutcome =
        input.action === "APPROVE" && input.reasonCode === "CONTENT_POLICY_COMPLIANT"
          ? "FALSE_POSITIVE"
          : input.reasonCode === "DUPLICATE_CONTENT"
            ? "CONFIRMED"
            : null;
      const duplicateCandidateIds =
        duplicateReviewOutcome === null
          ? []
          : (currentCase.evaluation?.duplicateCandidates.map((candidate) => candidate.id) ?? []);
      if (input.reasonCode === "DUPLICATE_CONTENT" && duplicateCandidateIds.length === 0) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (duplicateReviewOutcome && duplicateCandidateIds.length > 0) {
        const reviewed = await transaction.moderationDuplicateCandidate.updateMany({
          where: {
            id: { in: duplicateCandidateIds },
            reviewOutcome: "UNREVIEWED",
            reviewedAt: null,
          },
          data: {
            reviewOutcome: duplicateReviewOutcome,
            reviewedAt: input.occurredAt,
          },
        });
        if (reviewed.count !== duplicateCandidateIds.length) {
          throw new Error("Duplicate candidate review changed during moderation action");
        }
      }
      const metadata = {
        previousCaseStatus: currentCase.status,
        currentCaseStatus: nextCaseStatus,
        previousContentStatus: listing.status,
        currentContentStatus: input.nextListing.status,
        previousModerationStatus: listing.moderationStatus,
        currentModerationStatus: input.nextListing.moderationStatus,
        previousCaseVersion: currentCase.version,
        caseVersion: nextCaseVersion,
        previousListingVersion: listing.version,
        listingVersion: input.nextListing.version,
        duplicateReviewOutcome,
        duplicateCandidateCount: duplicateCandidateIds.length,
      } satisfies Prisma.InputJsonObject;
      const action = await transaction.moderationAction.create({
        data: {
          caseId: currentCase.id,
          actorId: input.actorUserId,
          action: input.action,
          reasonCode: input.reasonCode,
          note: input.note,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          metadata,
          createdAt: input.occurredAt,
        },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "ADMIN",
          action: "moderation.case.action.applied",
          targetType: "MODERATION_CASE",
          targetId: currentCase.id,
          requestId: input.requestId,
          metadata: {
            actionId: action.id,
            listingId: currentCase.targetId,
            action: input.action,
            reasonCode: input.reasonCode,
            authenticationStrength: "MFA",
            ...metadata,
          },
        },
      });
      const eventType =
        input.action === "APPROVE"
          ? input.nextListing.status === ContentStatus.EXPIRED
            ? "listing.expired"
            : "listing.published"
          : input.action === "REQUEST_CHANGES"
            ? "listing.moderation.returned"
            : input.action === "REJECT"
              ? "listing.moderation.rejected"
              : "listing.moderation.escalated";
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "LISTING",
          aggregateId: currentCase.targetId,
          eventType,
          payload: {
            schemaVersion: 1,
            aggregateVersion: input.nextListing.version,
            listingId: currentCase.targetId,
            type: listing.type,
            caseId: currentCase.id,
            actionId: action.id,
            action: input.action,
            reasonCode: input.reasonCode,
            previousStatus: listing.status,
            currentStatus: input.nextListing.status,
            previousModerationStatus: listing.moderationStatus,
            currentModerationStatus: input.nextListing.moderationStatus,
          },
        },
      });
      return {
        kind: "committed",
        duplicateReview:
          duplicateReviewOutcome && duplicateCandidateIds.length > 0
            ? {
                outcome: duplicateReviewOutcome,
                candidateCount: duplicateCandidateIds.length,
              }
            : null,
        action: {
          caseId: currentCase.id,
          actionId: action.id,
          action: input.action,
          reasonCode: input.reasonCode,
          previousCaseStatus: currentCase.status,
          currentCaseStatus: nextCaseStatus,
          previousContentStatus: listing.status,
          currentContentStatus: input.nextListing.status,
          previousModerationStatus: listing.moderationStatus,
          currentModerationStatus: input.nextListing.moderationStatus,
          caseVersion: nextCaseVersion,
          listingVersion: input.nextListing.version,
          occurredAt: input.occurredAt,
        },
      };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.#ownedClient) {
      return this.#ownedClient.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    }
    return operation(this.#client as Prisma.TransactionClient);
  }
}
