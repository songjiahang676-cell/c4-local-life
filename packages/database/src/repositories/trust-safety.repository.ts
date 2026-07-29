import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AuthenticationStrength,
  ContentStatus,
  MediaStatus,
  ModerationAppealStatus,
  ModerationCaseStatus,
  ModerationStatus,
  PlatformRole,
  Prisma,
  PrismaClient,
  ReportStatus,
  UserStatus,
  type ContactMode,
  type ListingType,
  type PriceUnit,
} from "../../generated/prisma/client";
import type { ModerationListingSnapshot } from "./moderation-case.repository";

export type TrustSafetyRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export const reportReasonCodes = [
  "SCAM_OR_FRAUD",
  "PROHIBITED_CONTENT",
  "MISLEADING_INFORMATION",
  "HARASSMENT_OR_HATE",
  "PRIVACY_OR_CONTACT_ABUSE",
  "OTHER",
] as const;
export type ReportReasonCode = (typeof reportReasonCodes)[number];

export type ReportModerationActionKind = "DISMISS" | "REMOVE_CONTENT" | "ESCALATE";
export type AppealModerationActionKind = "UPHOLD" | "RESTORE";
export type TrustSafetyActionKind = ReportModerationActionKind | AppealModerationActionKind;
export type ReportModerationReasonCode =
  | "NOT_A_VIOLATION"
  | "DUPLICATE_REPORT"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFIRMED_SCAM"
  | "PROHIBITED_CONTENT"
  | "MISLEADING_CONTENT"
  | "PRIVACY_VIOLATION"
  | "ESCALATE_SENIOR_REVIEW";
export type AppealModerationReasonCode = "ACTION_CONFIRMED" | "ACTION_OVERTURNED";
export const appealReasonCodes = ["ACTION_CONFIRMED", "ACTION_OVERTURNED"] as const;

export type TrustSafetyCursor = {
  priority: number;
  createdAt: Date;
  id: string;
};

export type ReportReceiptRecord = {
  id: string;
  targetId: string;
  reasonCode: ReportReasonCode;
  status: "OPEN" | "TRIAGED";
  deduplicated: boolean;
  submittedAt: Date;
};

export type AppealReceiptRecord = {
  id: string;
  moderationActionId: string;
  status: "OPEN";
  appealDeadline: Date;
  deduplicated: boolean;
  submittedAt: Date;
};

export type ReportCaseListItem = {
  reportId: string;
  caseId: string;
  targetId: string;
  reasonCode: ReportReasonCode;
  reportStatus: ReportStatus;
  caseStatus: Exclude<ModerationCaseStatus, "APPEALED">;
  priority: number;
  caseVersion: number;
  title: string;
  listingType: ListingType;
  createdAt: Date;
  updatedAt: Date;
};

export type AppealCaseListItem = {
  appealId: string;
  caseId: string;
  moderationActionId: string;
  targetId: string;
  appealStatus: ModerationAppealStatus;
  caseStatus: Exclude<ModerationCaseStatus, "APPEALED">;
  priority: number;
  caseVersion: number;
  title: string;
  listingType: ListingType;
  createdAt: Date;
  updatedAt: Date;
};

export type TrustSafetyActionHistoryItem = {
  id: string;
  action: TrustSafetyActionKind;
  reasonCode: string;
  note: string | null;
  createdAt: Date;
};

export type ReportCaseDetailRecord = {
  item: ReportCaseListItem;
  reporterStatement: string | null;
  snapshot: ModerationListingSnapshot;
  snapshotHash: string;
  evidenceCapturedAt: Date;
  listing: TrustSafetyListingState;
  actions: TrustSafetyActionHistoryItem[];
};

export type AppealCaseDetailRecord = {
  item: AppealCaseListItem;
  statement: string;
  originalAction: {
    id: string;
    actorId: string;
    action: "REMOVE_CONTENT";
    reasonCode: string;
    occurredAt: Date;
  };
  snapshot: ModerationListingSnapshot;
  snapshotHash: string;
  evidenceCapturedAt: Date;
  listing: TrustSafetyListingState;
  actions: TrustSafetyActionHistoryItem[];
};

export type TrustSafetyListingState = {
  id: string;
  type: ListingType;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type TrustSafetyActionProjection = {
  caseId: string;
  actionId: string;
  action: TrustSafetyActionKind;
  reasonCode: string;
  currentCaseStatus: Exclude<ModerationCaseStatus, "APPEALED">;
  currentContentStatus: ContentStatus;
  currentModerationStatus: ModerationStatus;
  caseVersion: number;
  listingVersion: number;
  occurredAt: Date;
};

export type CreateReportInput = {
  actorUserId: string;
  sessionId: string;
  targetId: string;
  reasonCode: ReportReasonCode;
  details?: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
};

export type CreateReportResult =
  | { kind: "created" | "exact_retry" | "deduplicated"; receipt: ReportReceiptRecord }
  | {
      kind:
        | "actor_unavailable"
        | "idempotency_conflict"
        | "not_found"
        | "rate_limited"
        | "self_report_forbidden";
    };

export type CreateAppealInput = {
  actorUserId: string;
  sessionId: string;
  moderationActionId: string;
  statement: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
};

export type CreateAppealResult =
  | { kind: "created" | "exact_retry" | "deduplicated"; receipt: AppealReceiptRecord }
  | {
      kind:
        | "actor_unavailable"
        | "appeal_expired"
        | "idempotency_conflict"
        | "not_found"
        | "not_owner"
        | "state_conflict";
    };

export type ListReportCasesInput = {
  actorUserId: string;
  sessionId: string;
  status: "OPEN" | "ASSIGNED" | "RESOLVED" | "CLOSED";
  cursor?: TrustSafetyCursor;
  limit: number;
  now: Date;
};

export type ListAppealCasesInput = {
  actorUserId: string;
  sessionId: string;
  status: "OPEN" | "UPHELD" | "RESTORED" | "CLOSED";
  cursor?: TrustSafetyCursor;
  limit: number;
  now: Date;
};

export type ListReportCasesResult =
  | {
      kind: "listed";
      items: ReportCaseListItem[];
      nextCursor: TrustSafetyCursor | null;
    }
  | { kind: "actor_unavailable" };

export type ListAppealCasesResult =
  | {
      kind: "listed";
      items: AppealCaseListItem[];
      nextCursor: TrustSafetyCursor | null;
    }
  | { kind: "actor_unavailable" };

export type GetReportCaseInput = {
  actorUserId: string;
  sessionId: string;
  reportId: string;
  now: Date;
};

export type GetAppealCaseInput = {
  actorUserId: string;
  sessionId: string;
  appealId: string;
  now: Date;
};

export type GetReportCaseResult =
  { kind: "found"; detail: ReportCaseDetailRecord } | { kind: "actor_unavailable" | "not_found" };

export type GetAppealCaseResult =
  { kind: "found"; detail: AppealCaseDetailRecord } | { kind: "actor_unavailable" | "not_found" };

type NextListingState = {
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  version: number;
};

export type CommitReportActionInput = {
  actorUserId: string;
  sessionId: string;
  recentMfaAfter: Date;
  reportId: string;
  expectedCaseVersion: number;
  expectedListingVersion: number;
  action: ReportModerationActionKind;
  reasonCode: ReportModerationReasonCode;
  note?: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
  nextListing: NextListingState;
};

export type CommitAppealActionInput = {
  actorUserId: string;
  sessionId: string;
  recentMfaAfter: Date;
  appealId: string;
  expectedCaseVersion: number;
  expectedListingVersion: number;
  action: AppealModerationActionKind;
  reasonCode: AppealModerationReasonCode;
  note?: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
  nextListing: NextListingState;
};

export type CommitTrustSafetyActionResult =
  | { kind: "committed" | "exact_retry"; action: TrustSafetyActionProjection }
  | {
      kind:
        | "actor_unavailable"
        | "idempotency_conflict"
        | "not_found"
        | "same_reviewer"
        | "state_conflict"
        | "time_conflict"
        | "version_conflict";
      currentCaseVersion?: number;
    };

type TrustSafetyClient = PrismaClient | Prisma.TransactionClient;

const moderatorRoles = [PlatformRole.MODERATOR, PlatformRole.SENIOR_MODERATOR] as const;
const reportReasonByAction: Readonly<
  Record<ReportModerationActionKind, readonly ReportModerationReasonCode[]>
> = {
  DISMISS: ["NOT_A_VIOLATION", "DUPLICATE_REPORT", "INSUFFICIENT_EVIDENCE"],
  REMOVE_CONTENT: [
    "CONFIRMED_SCAM",
    "PROHIBITED_CONTENT",
    "MISLEADING_CONTENT",
    "PRIVACY_VIOLATION",
  ],
  ESCALATE: ["ESCALATE_SENIOR_REVIEW"],
};
const appealReasonByAction: Readonly<
  Record<AppealModerationActionKind, readonly AppealModerationReasonCode[]>
> = {
  UPHOLD: ["ACTION_CONFIRMED"],
  RESTORE: ["ACTION_OVERTURNED"],
};
const appealWindowMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const reportsPerHour = 10;

function isRepositoryOptions(
  target: TrustSafetyClient | TrustSafetyRepositoryOptions,
): target is TrustSafetyRepositoryOptions {
  return "connectionString" in target;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function safeSnapshotAttributes(
  attributes: Prisma.JsonValue,
  definition: Prisma.JsonValue,
): Prisma.InputJsonObject {
  if (
    !attributes ||
    Array.isArray(attributes) ||
    typeof attributes !== "object" ||
    !definition ||
    Array.isArray(definition) ||
    typeof definition !== "object"
  ) {
    return {};
  }
  const fields = definition.fields;
  if (!Array.isArray(fields)) return {};
  const allowed = new Set(
    fields.flatMap((field) => {
      if (!field || Array.isArray(field) || typeof field !== "object") return [];
      const key = field.key;
      const type = field.type;
      if (
        typeof key !== "string" ||
        type === "PHONE" ||
        type === "EMAIL" ||
        /(phone|email|contact|address)/i.test(key)
      ) {
        return [];
      }
      return [key];
    }),
  );
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => allowed.has(key)),
  ) as Prisma.InputJsonObject;
}

function defaultLifetimeDays(definition: Prisma.JsonValue): number {
  if (!definition || Array.isArray(definition) || typeof definition !== "object") return 30;
  const policy = definition.publicationPolicy;
  if (!policy || Array.isArray(policy) || typeof policy !== "object") return 30;
  const value = policy.defaultLifetimeDays;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : 30;
}

function reportPriority(reasonCode: ReportReasonCode): number {
  if (reasonCode === "SCAM_OR_FRAUD") return 90;
  if (reasonCode === "PROHIBITED_CONTENT" || reasonCode === "PRIVACY_OR_CONTACT_ABUSE") {
    return 80;
  }
  return 60;
}

function isReportReasonCode(value: string): value is ReportReasonCode {
  return reportReasonCodes.includes(value as ReportReasonCode);
}

function isTrustSafetyAction(value: string): value is TrustSafetyActionKind {
  return ["DISMISS", "REMOVE_CONTENT", "ESCALATE", "UPHOLD", "RESTORE"].includes(value);
}

function parseSnapshot(value: Prisma.JsonValue): ModerationListingSnapshot | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.listingId !== "string" ||
    typeof snapshot.listingVersion !== "number" ||
    !["JOB", "RENTAL", "TRANSFER", "SECONDHAND", "SERVICE"].includes(String(snapshot.type)) ||
    (snapshot.locale !== "zh-Hans" && snapshot.locale !== "en-US") ||
    typeof snapshot.title !== "string" ||
    (snapshot.summary !== null && typeof snapshot.summary !== "string") ||
    typeof snapshot.body !== "string" ||
    !snapshot.attributes ||
    Array.isArray(snapshot.attributes) ||
    typeof snapshot.attributes !== "object" ||
    !["IN_APP", "PHONE_REVEAL", "EMAIL_REVEAL"].includes(String(snapshot.contactMode)) ||
    !["CITY", "NEIGHBORHOOD", "APPROXIMATE", "EXACT"].includes(
      String(snapshot.locationPrecision),
    ) ||
    !Array.isArray(snapshot.mediaIds) ||
    !snapshot.mediaIds.every((id) => typeof id === "string") ||
    !snapshot.category ||
    Array.isArray(snapshot.category) ||
    typeof snapshot.category !== "object" ||
    !snapshot.region ||
    Array.isArray(snapshot.region) ||
    typeof snapshot.region !== "object" ||
    typeof snapshot.formSchemaVersion !== "number" ||
    typeof snapshot.defaultLifetimeDays !== "number" ||
    snapshot.sensitiveFieldsRedacted !== true ||
    typeof snapshot.capturedAt !== "string"
  ) {
    return null;
  }
  const category = snapshot.category as Record<string, unknown>;
  const region = snapshot.region as Record<string, unknown>;
  if (
    [category.id, category.code, category.nameZhHans, category.nameEn].some(
      (item) => typeof item !== "string",
    ) ||
    [region.id, region.code, region.nameZhHans, region.nameEn].some(
      (item) => typeof item !== "string",
    )
  ) {
    return null;
  }
  const priceValue = snapshot.price;
  let price: ModerationListingSnapshot["price"];
  if (priceValue === null) {
    price = null;
  } else {
    if (!priceValue || Array.isArray(priceValue) || typeof priceValue !== "object") {
      return null;
    }
    const priceRecord = priceValue as Record<string, unknown>;
    if (
      (priceRecord.amount !== null && typeof priceRecord.amount !== "string") ||
      priceRecord.currency !== "USD" ||
      typeof priceRecord.unit !== "string"
    ) {
      return null;
    }
    price = {
      amount: priceRecord.amount,
      currency: "USD",
      unit: priceRecord.unit as PriceUnit,
    };
  }
  return {
    listingId: snapshot.listingId,
    listingVersion: snapshot.listingVersion,
    type: snapshot.type as ListingType,
    locale: snapshot.locale,
    title: snapshot.title,
    summary: snapshot.summary,
    body: snapshot.body,
    price,
    attributes: snapshot.attributes as Record<string, unknown>,
    contactMode: snapshot.contactMode as ContactMode,
    locationPrecision: snapshot.locationPrecision as ModerationListingSnapshot["locationPrecision"],
    mediaIds: [...snapshot.mediaIds],
    category: {
      id: category.id as string,
      code: category.code as string,
      nameZhHans: category.nameZhHans as string,
      nameEn: category.nameEn as string,
    },
    region: {
      id: region.id as string,
      code: region.code as string,
      nameZhHans: region.nameZhHans as string,
      nameEn: region.nameEn as string,
    },
    formSchemaVersion: snapshot.formSchemaVersion,
    defaultLifetimeDays: snapshot.defaultLifetimeDays,
    sensitiveFieldsRedacted: true,
    capturedAt: snapshot.capturedAt,
  };
}

function mapListingState(row: {
  id: string;
  type: ListingType;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}): TrustSafetyListingState {
  return { ...row };
}

function actionHistory(
  actions: {
    id: string;
    action: string;
    reasonCode: string | null;
    note: string | null;
    createdAt: Date;
  }[],
): TrustSafetyActionHistoryItem[] | null {
  const result: TrustSafetyActionHistoryItem[] = [];
  for (const action of actions) {
    if (!isTrustSafetyAction(action.action) || !action.reasonCode) return null;
    result.push({
      id: action.id,
      action: action.action,
      reasonCode: action.reasonCode,
      note: action.note,
      createdAt: action.createdAt,
    });
  }
  return result;
}

function projectionFromMetadata(row: {
  id: string;
  caseId: string;
  action: string;
  reasonCode: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}): TrustSafetyActionProjection | null {
  if (
    !isTrustSafetyAction(row.action) ||
    !row.reasonCode ||
    !row.metadata ||
    Array.isArray(row.metadata) ||
    typeof row.metadata !== "object"
  ) {
    return null;
  }
  const metadata = row.metadata;
  if (
    typeof metadata.currentCaseStatus !== "string" ||
    typeof metadata.currentContentStatus !== "string" ||
    typeof metadata.currentModerationStatus !== "string" ||
    typeof metadata.caseVersion !== "number" ||
    typeof metadata.listingVersion !== "number"
  ) {
    return null;
  }
  if (metadata.currentCaseStatus === ModerationCaseStatus.APPEALED) return null;
  return {
    caseId: row.caseId,
    actionId: row.id,
    action: row.action,
    reasonCode: row.reasonCode,
    currentCaseStatus: metadata.currentCaseStatus as Exclude<ModerationCaseStatus, "APPEALED">,
    currentContentStatus: metadata.currentContentStatus as ContentStatus,
    currentModerationStatus: metadata.currentModerationStatus as ModerationStatus,
    caseVersion: metadata.caseVersion,
    listingVersion: metadata.listingVersion,
    occurredAt: row.createdAt,
  };
}

async function validActiveSession(
  client: TrustSafetyClient,
  actorUserId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  return (
    (await client.authSession.findFirst({
      where: {
        id: sessionId,
        userId: actorUserId,
        revokedAt: null,
        expiresAt: { gt: now },
        idleExpiresAt: { gt: now },
        user: { status: UserStatus.ACTIVE, deletedAt: null },
      },
      select: { id: true },
    })) !== null
  );
}

async function validModeratorSession(
  client: TrustSafetyClient,
  input: {
    actorUserId: string;
    sessionId: string;
    now: Date;
    recentMfaAfter?: Date;
  },
): Promise<boolean> {
  return (
    (await client.authSession.findFirst({
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
    })) !== null
  );
}

async function lockRow(
  transaction: Prisma.TransactionClient,
  table: "listings" | "moderation_cases" | "reports" | "moderation_appeals",
  id: string,
): Promise<boolean> {
  const tableName = Prisma.raw(`"${table}"`);
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM ${tableName} WHERE "id" = ${id}::uuid FOR UPDATE`,
  );
  return rows.length === 1;
}

async function buildSnapshot(
  transaction: Prisma.TransactionClient,
  listingId: string,
  occurredAt: Date,
  requirePublished: boolean,
): Promise<{
  snapshot: Prisma.InputJsonObject;
  snapshotHash: string;
  listing: TrustSafetyListingState & { ownerId: string };
} | null> {
  const row = await transaction.listing.findFirst({
    where: {
      id: listingId,
      deletedAt: null,
      ...(requirePublished
        ? {
            status: ContentStatus.PUBLISHED,
            moderationStatus: {
              in: [ModerationStatus.AUTO_APPROVED, ModerationStatus.APPROVED],
            },
            publishedAt: { not: null, lte: occurredAt },
            expiresAt: { gt: occurredAt },
            category: { is: { isActive: true } },
            region: { is: { isActive: true } },
            owner: {
              is: {
                status: { in: [UserStatus.ACTIVE, UserStatus.LIMITED] },
                deletedAt: null,
                profile: { isNot: null },
              },
            },
          }
        : {}),
    },
    select: {
      id: true,
      type: true,
      ownerId: true,
      status: true,
      moderationStatus: true,
      locale: true,
      title: true,
      summary: true,
      body: true,
      priceAmount: true,
      priceUnit: true,
      attributes: true,
      contactMode: true,
      locationPrecision: true,
      formSchemaVersion: true,
      publishedAt: true,
      expiresAt: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      category: {
        select: {
          id: true,
          slug: true,
          nameZhHans: true,
          nameEn: true,
        },
      },
      region: {
        select: {
          id: true,
          code: true,
          nameZhHans: true,
          nameEn: true,
        },
      },
      uploadedMedia: {
        where: { status: MediaStatus.READY },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      },
    },
  });
  if (!row || (row.locale !== "zh-Hans" && row.locale !== "en-US")) return null;
  const formSchema = await transaction.categoryFormSchemaVersion.findUnique({
    where: {
      categoryId_version: {
        categoryId: row.category.id,
        version: row.formSchemaVersion,
      },
    },
    select: { definition: true, publishedAt: true },
  });
  if (!formSchema?.publishedAt) return null;
  const snapshot = {
    listingId: row.id,
    listingVersion: row.version,
    type: row.type,
    locale: row.locale,
    title: row.title,
    summary: row.summary,
    body: row.body,
    price: row.priceUnit
      ? {
          amount: row.priceAmount?.toFixed(2) ?? null,
          currency: "USD",
          unit: row.priceUnit,
        }
      : null,
    attributes: safeSnapshotAttributes(row.attributes, formSchema.definition),
    contactMode: row.contactMode,
    locationPrecision: row.locationPrecision,
    mediaIds: row.uploadedMedia.map((media) => media.id),
    category: {
      id: row.category.id,
      code: row.category.slug,
      nameZhHans: row.category.nameZhHans,
      nameEn: row.category.nameEn,
    },
    region: {
      id: row.region.id,
      code: row.region.code,
      nameZhHans: row.region.nameZhHans,
      nameEn: row.region.nameEn,
    },
    formSchemaVersion: row.formSchemaVersion,
    defaultLifetimeDays: defaultLifetimeDays(formSchema.definition),
    sensitiveFieldsRedacted: true,
    capturedAt: occurredAt.toISOString(),
  } satisfies Prisma.InputJsonObject;
  return {
    snapshot,
    snapshotHash: createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
    listing: {
      id: row.id,
      type: row.type,
      ownerId: row.ownerId,
      status: row.status,
      moderationStatus: row.moderationStatus,
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    },
  };
}

function reportListItem(row: {
  id: string;
  targetId: string;
  reasonCode: string;
  status: ReportStatus;
  createdAt: Date;
  updatedAt: Date;
  moderationCase: {
    id: string;
    status: ModerationCaseStatus;
    priority: number;
    version: number;
    updatedAt: Date;
    snapshot: { snapshot: Prisma.JsonValue } | null;
  } | null;
}): ReportCaseListItem | null {
  const snapshot = row.moderationCase?.snapshot
    ? parseSnapshot(row.moderationCase.snapshot.snapshot)
    : null;
  if (
    !row.moderationCase ||
    row.moderationCase.status === ModerationCaseStatus.APPEALED ||
    !snapshot ||
    !isReportReasonCode(row.reasonCode)
  ) {
    return null;
  }
  return {
    reportId: row.id,
    caseId: row.moderationCase.id,
    targetId: row.targetId,
    reasonCode: row.reasonCode,
    reportStatus: row.status,
    caseStatus: row.moderationCase.status,
    priority: row.moderationCase.priority,
    caseVersion: row.moderationCase.version,
    title: snapshot.title,
    listingType: snapshot.type,
    createdAt: row.createdAt,
    updatedAt:
      row.updatedAt > row.moderationCase.updatedAt ? row.updatedAt : row.moderationCase.updatedAt,
  };
}

function appealListItem(row: {
  id: string;
  moderationActionId: string;
  status: ModerationAppealStatus;
  createdAt: Date;
  updatedAt: Date;
  moderationAction: { moderationCase: { targetId: string } };
  moderationCase: {
    id: string;
    status: ModerationCaseStatus;
    priority: number;
    version: number;
    updatedAt: Date;
    snapshot: { snapshot: Prisma.JsonValue } | null;
  } | null;
}): AppealCaseListItem | null {
  const snapshot = row.moderationCase?.snapshot
    ? parseSnapshot(row.moderationCase.snapshot.snapshot)
    : null;
  if (
    !row.moderationCase ||
    row.moderationCase.status === ModerationCaseStatus.APPEALED ||
    !snapshot
  ) {
    return null;
  }
  return {
    appealId: row.id,
    caseId: row.moderationCase.id,
    moderationActionId: row.moderationActionId,
    targetId: row.moderationAction.moderationCase.targetId,
    appealStatus: row.status,
    caseStatus: row.moderationCase.status,
    priority: row.moderationCase.priority,
    caseVersion: row.moderationCase.version,
    title: snapshot.title,
    listingType: snapshot.type,
    createdAt: row.createdAt,
    updatedAt:
      row.updatedAt > row.moderationCase.updatedAt ? row.updatedAt : row.moderationCase.updatedAt,
  };
}

const caseCursorWhere = (cursor: TrustSafetyCursor | undefined): Prisma.ModerationCaseWhereInput =>
  cursor
    ? {
        OR: [
          { priority: { lt: cursor.priority } },
          { priority: cursor.priority, createdAt: { gt: cursor.createdAt } },
          {
            priority: cursor.priority,
            createdAt: cursor.createdAt,
            id: { gt: cursor.id },
          },
        ],
      }
    : {};

export class TrustSafetyRepository {
  readonly #client: TrustSafetyClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: TrustSafetyClient | TrustSafetyRepositoryOptions) {
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

  createReport(input: CreateReportInput): Promise<CreateReportResult> {
    return this.#inTransaction(async (transaction) => {
      if (
        !(await validActiveSession(
          transaction,
          input.actorUserId,
          input.sessionId,
          input.occurredAt,
        ))
      ) {
        return { kind: "actor_unavailable" };
      }
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.actorUserId}:report:${input.targetId}`}, 7413))`,
      );
      const prior = await transaction.report.findFirst({
        where: {
          reporterId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          id: true,
          targetId: true,
          reasonCode: true,
          requestHash: true,
          createdAt: true,
        },
      });
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          return { kind: "idempotency_conflict" };
        }
        if (!isReportReasonCode(prior.reasonCode)) {
          return { kind: "idempotency_conflict" };
        }
        return {
          kind: "exact_retry",
          receipt: {
            id: prior.id,
            targetId: prior.targetId,
            reasonCode: prior.reasonCode,
            status: "OPEN",
            deduplicated: false,
            submittedAt: prior.createdAt,
          },
        };
      }
      const evidence = await buildSnapshot(transaction, input.targetId, input.occurredAt, true);
      if (!evidence) return { kind: "not_found" };
      if (evidence.listing.ownerId === input.actorUserId) {
        return { kind: "self_report_forbidden" };
      }
      const duplicate = await transaction.report.findFirst({
        where: {
          reporterId: input.actorUserId,
          targetType: "LISTING",
          targetId: input.targetId,
          status: { in: [ReportStatus.OPEN, ReportStatus.TRIAGED] },
        },
        select: {
          id: true,
          targetId: true,
          reasonCode: true,
          status: true,
          createdAt: true,
        },
      });
      if (duplicate) {
        if (!isReportReasonCode(duplicate.reasonCode)) {
          throw new Error("Stored report reason is invalid");
        }
        return {
          kind: "deduplicated",
          receipt: {
            id: duplicate.id,
            targetId: duplicate.targetId,
            reasonCode: duplicate.reasonCode,
            status: duplicate.status as "OPEN" | "TRIAGED",
            deduplicated: true,
            submittedAt: duplicate.createdAt,
          },
        };
      }
      const recentReportCount = await transaction.report.count({
        where: {
          reporterId: input.actorUserId,
          createdAt: {
            gte: new Date(input.occurredAt.getTime() - 60 * 60_000),
            lte: input.occurredAt,
          },
        },
      });
      if (recentReportCount >= reportsPerHour) return { kind: "rate_limited" };
      const report = await transaction.report.create({
        data: {
          reporterId: input.actorUserId,
          targetType: "LISTING",
          targetId: input.targetId,
          reasonCode: input.reasonCode,
          details: input.details,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          status: ReportStatus.OPEN,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: { id: true },
      });
      const moderationCase = await transaction.moderationCase.create({
        data: {
          reportId: report.id,
          targetType: "LISTING",
          targetId: input.targetId,
          queue: "listing-report",
          priority: reportPriority(input.reasonCode),
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: { id: true },
      });
      await transaction.moderationCaseSnapshot.create({
        data: {
          caseId: moderationCase.id,
          listingVersion: evidence.listing.version,
          snapshot: evidence.snapshot,
          snapshotHash: evidence.snapshotHash,
          capturedAt: input.occurredAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "USER",
          action: "moderation.report.created",
          targetType: "REPORT",
          targetId: report.id,
          requestId: input.requestId,
          metadata: {
            caseId: moderationCase.id,
            listingId: input.targetId,
            reasonCode: input.reasonCode,
            snapshotHash: evidence.snapshotHash,
            reporterIdentityExposed: false,
          },
        },
      });
      return {
        kind: "created",
        receipt: {
          id: report.id,
          targetId: input.targetId,
          reasonCode: input.reasonCode,
          status: "OPEN",
          deduplicated: false,
          submittedAt: input.occurredAt,
        },
      };
    });
  }

  createAppeal(input: CreateAppealInput): Promise<CreateAppealResult> {
    return this.#inTransaction(async (transaction) => {
      if (
        !(await validActiveSession(
          transaction,
          input.actorUserId,
          input.sessionId,
          input.occurredAt,
        ))
      ) {
        return { kind: "actor_unavailable" };
      }
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.actorUserId}:appeal:${input.moderationActionId}`}, 7413))`,
      );
      const prior = await transaction.moderationAppeal.findFirst({
        where: {
          appellantId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          id: true,
          moderationActionId: true,
          requestHash: true,
          createdAt: true,
          moderationAction: { select: { createdAt: true } },
        },
      });
      if (prior) {
        if (prior.requestHash !== input.requestHash) {
          return { kind: "idempotency_conflict" };
        }
        return {
          kind: "exact_retry",
          receipt: {
            id: prior.id,
            moderationActionId: prior.moderationActionId,
            status: "OPEN",
            appealDeadline: new Date(
              prior.moderationAction.createdAt.getTime() + appealWindowMilliseconds,
            ),
            deduplicated: false,
            submittedAt: prior.createdAt,
          },
        };
      }
      const originalAction = await transaction.moderationAction.findFirst({
        where: {
          id: input.moderationActionId,
          action: "REMOVE_CONTENT",
          moderationCase: { queue: "listing-report" },
        },
        select: {
          id: true,
          createdAt: true,
          moderationCase: {
            select: {
              targetId: true,
            },
          },
          appeal: {
            select: {
              id: true,
              appellantId: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
      if (!originalAction) return { kind: "not_found" };
      const appealDeadline = new Date(
        originalAction.createdAt.getTime() + appealWindowMilliseconds,
      );
      if (input.occurredAt > appealDeadline) return { kind: "appeal_expired" };
      const evidence = await buildSnapshot(
        transaction,
        originalAction.moderationCase.targetId,
        input.occurredAt,
        false,
      );
      if (!evidence) return { kind: "not_found" };
      if (evidence.listing.ownerId !== input.actorUserId) return { kind: "not_owner" };
      if (
        evidence.listing.status !== ContentStatus.SUSPENDED ||
        evidence.listing.moderationStatus !== ModerationStatus.REJECTED
      ) {
        return { kind: "state_conflict" };
      }
      if (originalAction.appeal) {
        if (
          originalAction.appeal.appellantId !== input.actorUserId ||
          originalAction.appeal.status !== ModerationAppealStatus.OPEN
        ) {
          return { kind: "state_conflict" };
        }
        return {
          kind: "deduplicated",
          receipt: {
            id: originalAction.appeal.id,
            moderationActionId: originalAction.id,
            status: "OPEN",
            appealDeadline,
            deduplicated: true,
            submittedAt: originalAction.appeal.createdAt,
          },
        };
      }
      const appeal = await transaction.moderationAppeal.create({
        data: {
          moderationActionId: originalAction.id,
          appellantId: input.actorUserId,
          statement: input.statement,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          status: ModerationAppealStatus.OPEN,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: { id: true },
      });
      const moderationCase = await transaction.moderationCase.create({
        data: {
          appealId: appeal.id,
          targetType: "LISTING",
          targetId: evidence.listing.id,
          queue: "listing-appeal",
          priority: 80,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: { id: true },
      });
      await transaction.moderationCaseSnapshot.create({
        data: {
          caseId: moderationCase.id,
          listingVersion: evidence.listing.version,
          snapshot: evidence.snapshot,
          snapshotHash: evidence.snapshotHash,
          capturedAt: input.occurredAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "USER",
          action: "moderation.appeal.created",
          targetType: "MODERATION_APPEAL",
          targetId: appeal.id,
          requestId: input.requestId,
          metadata: {
            caseId: moderationCase.id,
            listingId: evidence.listing.id,
            originalActionId: originalAction.id,
            appealDeadline: appealDeadline.toISOString(),
            snapshotHash: evidence.snapshotHash,
          },
        },
      });
      return {
        kind: "created",
        receipt: {
          id: appeal.id,
          moderationActionId: originalAction.id,
          status: "OPEN",
          appealDeadline,
          deduplicated: false,
          submittedAt: input.occurredAt,
        },
      };
    });
  }

  async listReports(input: ListReportCasesInput): Promise<ListReportCasesResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const rows = await this.#client.report.findMany({
      where: {
        moderationCase: {
          is: {
            queue: "listing-report",
            status: input.status as ModerationCaseStatus,
            ...caseCursorWhere(input.cursor),
          },
        },
      },
      orderBy: [
        { moderationCase: { priority: "desc" } },
        { moderationCase: { createdAt: "asc" } },
        { moderationCase: { id: "asc" } },
      ],
      take: input.limit + 1,
      select: {
        id: true,
        targetId: true,
        reasonCode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        moderationCase: {
          select: {
            id: true,
            status: true,
            priority: true,
            version: true,
            updatedAt: true,
            snapshot: { select: { snapshot: true } },
          },
        },
      },
    });
    const mapped = rows.map(reportListItem);
    if (mapped.some((item) => item === null)) {
      throw new Error("Stored report moderation projection is invalid");
    }
    const items = mapped.slice(0, input.limit) as ReportCaseListItem[];
    const overflow = mapped.length > input.limit;
    const last = items.at(-1);
    return {
      kind: "listed",
      items,
      nextCursor:
        overflow && last
          ? {
              priority: last.priority,
              createdAt: last.createdAt,
              id: last.caseId,
            }
          : null,
    };
  }

  async listAppeals(input: ListAppealCasesInput): Promise<ListAppealCasesResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const rows = await this.#client.moderationAppeal.findMany({
      where: {
        status: input.status as ModerationAppealStatus,
        moderationCase: {
          is: {
            queue: "listing-appeal",
            ...caseCursorWhere(input.cursor),
          },
        },
      },
      orderBy: [
        { moderationCase: { priority: "desc" } },
        { moderationCase: { createdAt: "asc" } },
        { moderationCase: { id: "asc" } },
      ],
      take: input.limit + 1,
      select: {
        id: true,
        moderationActionId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        moderationAction: {
          select: { moderationCase: { select: { targetId: true } } },
        },
        moderationCase: {
          select: {
            id: true,
            status: true,
            priority: true,
            version: true,
            updatedAt: true,
            snapshot: { select: { snapshot: true } },
          },
        },
      },
    });
    const mapped = rows.map(appealListItem);
    if (mapped.some((item) => item === null)) {
      throw new Error("Stored appeal moderation projection is invalid");
    }
    const items = mapped.slice(0, input.limit) as AppealCaseListItem[];
    const overflow = mapped.length > input.limit;
    const last = items.at(-1);
    return {
      kind: "listed",
      items,
      nextCursor:
        overflow && last
          ? {
              priority: last.priority,
              createdAt: last.createdAt,
              id: last.caseId,
            }
          : null,
    };
  }

  async getReport(input: GetReportCaseInput): Promise<GetReportCaseResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const row = await this.#client.report.findFirst({
      where: {
        id: input.reportId,
        moderationCase: { is: { queue: "listing-report" } },
      },
      select: {
        id: true,
        targetId: true,
        reasonCode: true,
        details: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        moderationCase: {
          select: {
            id: true,
            status: true,
            priority: true,
            version: true,
            updatedAt: true,
            snapshot: {
              select: {
                snapshot: true,
                snapshotHash: true,
                capturedAt: true,
              },
            },
            actions: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                action: true,
                reasonCode: true,
                note: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    const item = row ? reportListItem(row) : null;
    const snapshot = row?.moderationCase?.snapshot
      ? parseSnapshot(row.moderationCase.snapshot.snapshot)
      : null;
    const actions = row?.moderationCase ? actionHistory(row.moderationCase.actions) : null;
    if (!row) return { kind: "not_found" };
    if (!item || !snapshot || !actions || !row.moderationCase?.snapshot) {
      throw new Error("Stored report moderation detail is invalid");
    }
    const listing = await this.#client.listing.findUnique({
      where: { id: row.targetId },
      select: {
        id: true,
        type: true,
        status: true,
        moderationStatus: true,
        publishedAt: true,
        expiresAt: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        version: true,
      },
    });
    if (!listing) return { kind: "not_found" };
    return {
      kind: "found",
      detail: {
        item,
        reporterStatement: row.details,
        snapshot,
        snapshotHash: row.moderationCase.snapshot.snapshotHash,
        evidenceCapturedAt: row.moderationCase.snapshot.capturedAt,
        listing: mapListingState(listing),
        actions,
      },
    };
  }

  async getAppeal(input: GetAppealCaseInput): Promise<GetAppealCaseResult> {
    if (!(await validModeratorSession(this.#client, input))) {
      return { kind: "actor_unavailable" };
    }
    const row = await this.#client.moderationAppeal.findFirst({
      where: {
        id: input.appealId,
        moderationCase: { is: { queue: "listing-appeal" } },
      },
      select: {
        id: true,
        moderationActionId: true,
        statement: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        moderationAction: {
          select: {
            id: true,
            actorId: true,
            action: true,
            reasonCode: true,
            createdAt: true,
            moderationCase: { select: { targetId: true } },
          },
        },
        moderationCase: {
          select: {
            id: true,
            status: true,
            priority: true,
            version: true,
            updatedAt: true,
            snapshot: {
              select: {
                snapshot: true,
                snapshotHash: true,
                capturedAt: true,
              },
            },
            actions: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                action: true,
                reasonCode: true,
                note: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    const item = row ? appealListItem(row) : null;
    const snapshot = row?.moderationCase?.snapshot
      ? parseSnapshot(row.moderationCase.snapshot.snapshot)
      : null;
    const actions = row?.moderationCase ? actionHistory(row.moderationCase.actions) : null;
    if (!row) return { kind: "not_found" };
    if (
      !item ||
      !snapshot ||
      !actions ||
      !row.moderationCase?.snapshot ||
      row.moderationAction.action !== "REMOVE_CONTENT" ||
      !row.moderationAction.reasonCode
    ) {
      throw new Error("Stored appeal moderation detail is invalid");
    }
    const listing = await this.#client.listing.findUnique({
      where: { id: row.moderationAction.moderationCase.targetId },
      select: {
        id: true,
        type: true,
        status: true,
        moderationStatus: true,
        publishedAt: true,
        expiresAt: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        version: true,
      },
    });
    if (!listing) return { kind: "not_found" };
    return {
      kind: "found",
      detail: {
        item,
        statement: row.statement,
        originalAction: {
          id: row.moderationAction.id,
          actorId: row.moderationAction.actorId,
          action: "REMOVE_CONTENT",
          reasonCode: row.moderationAction.reasonCode,
          occurredAt: row.moderationAction.createdAt,
        },
        snapshot,
        snapshotHash: row.moderationCase.snapshot.snapshotHash,
        evidenceCapturedAt: row.moderationCase.snapshot.capturedAt,
        listing: mapListingState(listing),
        actions,
      },
    };
  }

  commitReportAction(input: CommitReportActionInput): Promise<CommitTrustSafetyActionResult> {
    return this.#inTransaction(async (transaction) => {
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
      const prior = await transaction.moderationAction.findFirst({
        where: {
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
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
        if (prior.requestHash !== input.requestHash) {
          return { kind: "idempotency_conflict" };
        }
        const projection = projectionFromMetadata(prior);
        return projection
          ? { kind: "exact_retry", action: projection }
          : { kind: "state_conflict" };
      }
      const report = await transaction.report.findUnique({
        where: { id: input.reportId },
        select: { id: true, moderationCase: { select: { id: true } } },
      });
      if (!report?.moderationCase) return { kind: "not_found" };
      if (!(await lockRow(transaction, "moderation_cases", report.moderationCase.id))) {
        return { kind: "not_found" };
      }
      if (!(await lockRow(transaction, "reports", report.id))) {
        return { kind: "not_found" };
      }
      const currentCase = await transaction.moderationCase.findFirst({
        where: {
          id: report.moderationCase.id,
          reportId: report.id,
          queue: "listing-report",
        },
        select: {
          id: true,
          targetId: true,
          status: true,
          priority: true,
          version: true,
          updatedAt: true,
          report: { select: { status: true } },
        },
      });
      if (!currentCase?.report) return { kind: "not_found" };
      if (currentCase.version !== input.expectedCaseVersion) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        (currentCase.status !== ModerationCaseStatus.OPEN &&
          currentCase.status !== ModerationCaseStatus.ASSIGNED) ||
        (currentCase.report.status !== ReportStatus.OPEN &&
          currentCase.report.status !== ReportStatus.TRIAGED) ||
        !reportReasonByAction[input.action].includes(input.reasonCode)
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
          publishedAt: true,
          expiresAt: true,
          version: true,
          updatedAt: true,
        },
      });
      if (!listing) return { kind: "not_found" };
      if (listing.version !== input.expectedListingVersion) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (input.occurredAt < listing.updatedAt || input.occurredAt < currentCase.updatedAt) {
        return { kind: "time_conflict", currentCaseVersion: currentCase.version };
      }
      const removesContent = input.action === "REMOVE_CONTENT";
      if (
        removesContent &&
        (listing.status !== ContentStatus.PUBLISHED ||
          (listing.moderationStatus !== ModerationStatus.AUTO_APPROVED &&
            listing.moderationStatus !== ModerationStatus.APPROVED))
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        input.nextListing.version !== listing.version + (removesContent ? 1 : 0) ||
        (removesContent
          ? input.nextListing.status !== ContentStatus.SUSPENDED ||
            input.nextListing.moderationStatus !== ModerationStatus.REJECTED
          : input.nextListing.status !== listing.status ||
            input.nextListing.moderationStatus !== listing.moderationStatus)
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (removesContent) {
        const updated = await transaction.listing.updateMany({
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
            version: input.nextListing.version,
            updatedAt: input.occurredAt,
          },
        });
        if (updated.count !== 1) {
          throw new Error("Locked Listing changed during report action");
        }
      }
      const nextCaseStatus =
        input.action === "ESCALATE" ? ModerationCaseStatus.OPEN : ModerationCaseStatus.RESOLVED;
      const nextReportStatus =
        input.action === "DISMISS"
          ? ReportStatus.DISMISSED
          : input.action === "REMOVE_CONTENT"
            ? ReportStatus.ACTIONED
            : ReportStatus.TRIAGED;
      const nextCaseVersion = currentCase.version + 1;
      await transaction.moderationCase.update({
        where: { id: currentCase.id },
        data: {
          status: nextCaseStatus,
          priority: input.action === "ESCALATE" ? 100 : currentCase.priority,
          assignedToId: input.actorUserId,
          decisionCode: input.action === "ESCALATE" ? null : input.reasonCode,
          resolutionNote: input.action === "ESCALATE" ? null : (input.note ?? null),
          resolvedAt: input.action === "ESCALATE" ? null : input.occurredAt,
          version: nextCaseVersion,
          updatedAt: input.occurredAt,
        },
      });
      await transaction.report.update({
        where: { id: report.id },
        data: { status: nextReportStatus, updatedAt: input.occurredAt },
      });
      const metadata = {
        currentCaseStatus: nextCaseStatus,
        currentContentStatus: input.nextListing.status,
        currentModerationStatus: input.nextListing.moderationStatus,
        caseVersion: nextCaseVersion,
        listingVersion: input.nextListing.version,
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
          action: "moderation.report.action.applied",
          targetType: "REPORT",
          targetId: report.id,
          requestId: input.requestId,
          metadata: {
            caseId: currentCase.id,
            listingId: currentCase.targetId,
            actionId: action.id,
            action: input.action,
            reasonCode: input.reasonCode,
            reporterIdentityExposed: false,
            ...metadata,
          },
        },
      });
      if (removesContent) {
        await transaction.outboxEvent.create({
          data: {
            aggregateType: "LISTING",
            aggregateId: currentCase.targetId,
            eventType: "listing.moderation.removed",
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
      }
      return {
        kind: "committed",
        action: {
          caseId: currentCase.id,
          actionId: action.id,
          action: input.action,
          reasonCode: input.reasonCode,
          currentCaseStatus: nextCaseStatus,
          currentContentStatus: input.nextListing.status,
          currentModerationStatus: input.nextListing.moderationStatus,
          caseVersion: nextCaseVersion,
          listingVersion: input.nextListing.version,
          occurredAt: input.occurredAt,
        },
      };
    });
  }

  commitAppealAction(input: CommitAppealActionInput): Promise<CommitTrustSafetyActionResult> {
    return this.#inTransaction(async (transaction) => {
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
      const prior = await transaction.moderationAction.findFirst({
        where: {
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
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
        if (prior.requestHash !== input.requestHash) {
          return { kind: "idempotency_conflict" };
        }
        const projection = projectionFromMetadata(prior);
        return projection
          ? { kind: "exact_retry", action: projection }
          : { kind: "state_conflict" };
      }
      const appeal = await transaction.moderationAppeal.findUnique({
        where: { id: input.appealId },
        select: { id: true, moderationCase: { select: { id: true } } },
      });
      if (!appeal?.moderationCase) return { kind: "not_found" };
      if (!(await lockRow(transaction, "moderation_cases", appeal.moderationCase.id))) {
        return { kind: "not_found" };
      }
      if (!(await lockRow(transaction, "moderation_appeals", appeal.id))) {
        return { kind: "not_found" };
      }
      const currentCase = await transaction.moderationCase.findFirst({
        where: {
          id: appeal.moderationCase.id,
          appealId: appeal.id,
          queue: "listing-appeal",
        },
        select: {
          id: true,
          targetId: true,
          status: true,
          version: true,
          updatedAt: true,
          appeal: {
            select: {
              status: true,
              moderationAction: {
                select: {
                  id: true,
                  actorId: true,
                  moderationCase: {
                    select: {
                      reportId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!currentCase?.appeal) return { kind: "not_found" };
      if (currentCase.appeal.moderationAction.actorId === input.actorUserId) {
        return { kind: "same_reviewer", currentCaseVersion: currentCase.version };
      }
      if (currentCase.version !== input.expectedCaseVersion) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        currentCase.status !== ModerationCaseStatus.OPEN ||
        currentCase.appeal.status !== ModerationAppealStatus.OPEN ||
        !appealReasonByAction[input.action].includes(input.reasonCode)
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
          publishedAt: true,
          expiresAt: true,
          version: true,
          updatedAt: true,
        },
      });
      if (!listing) return { kind: "not_found" };
      if (listing.version !== input.expectedListingVersion) {
        return { kind: "version_conflict", currentCaseVersion: currentCase.version };
      }
      if (input.occurredAt < listing.updatedAt || input.occurredAt < currentCase.updatedAt) {
        return { kind: "time_conflict", currentCaseVersion: currentCase.version };
      }
      const restores = input.action === "RESTORE";
      if (
        listing.status !== ContentStatus.SUSPENDED ||
        listing.moderationStatus !== ModerationStatus.REJECTED ||
        (restores && (!listing.expiresAt || input.occurredAt >= listing.expiresAt))
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (
        input.nextListing.version !== listing.version + (restores ? 1 : 0) ||
        (restores
          ? input.nextListing.status !== ContentStatus.PUBLISHED ||
            input.nextListing.moderationStatus !== ModerationStatus.APPROVED
          : input.nextListing.status !== listing.status ||
            input.nextListing.moderationStatus !== listing.moderationStatus)
      ) {
        return { kind: "state_conflict", currentCaseVersion: currentCase.version };
      }
      if (restores) {
        const updated = await transaction.listing.updateMany({
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
            version: input.nextListing.version,
            updatedAt: input.occurredAt,
          },
        });
        if (updated.count !== 1) {
          throw new Error("Locked Listing changed during appeal action");
        }
      }
      const nextCaseVersion = currentCase.version + 1;
      const nextAppealStatus = restores
        ? ModerationAppealStatus.RESTORED
        : ModerationAppealStatus.UPHELD;
      await transaction.moderationCase.update({
        where: { id: currentCase.id },
        data: {
          status: ModerationCaseStatus.RESOLVED,
          assignedToId: input.actorUserId,
          decisionCode: input.reasonCode,
          resolutionNote: input.note ?? null,
          resolvedAt: input.occurredAt,
          version: nextCaseVersion,
          updatedAt: input.occurredAt,
        },
      });
      await transaction.moderationAppeal.update({
        where: { id: appeal.id },
        data: {
          status: nextAppealStatus,
          decisionCode: input.reasonCode,
          resolutionNote: input.note ?? null,
          resolvedAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
      });
      if (restores && currentCase.appeal.moderationAction.moderationCase.reportId) {
        await transaction.report.update({
          where: {
            id: currentCase.appeal.moderationAction.moderationCase.reportId,
          },
          data: { status: ReportStatus.CLOSED, updatedAt: input.occurredAt },
        });
      }
      const metadata = {
        currentCaseStatus: ModerationCaseStatus.RESOLVED,
        currentContentStatus: input.nextListing.status,
        currentModerationStatus: input.nextListing.moderationStatus,
        caseVersion: nextCaseVersion,
        listingVersion: input.nextListing.version,
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
          action: "moderation.appeal.action.applied",
          targetType: "MODERATION_APPEAL",
          targetId: appeal.id,
          requestId: input.requestId,
          metadata: {
            caseId: currentCase.id,
            listingId: currentCase.targetId,
            originalActionId: currentCase.appeal.moderationAction.id,
            actionId: action.id,
            action: input.action,
            reasonCode: input.reasonCode,
            differentReviewerEnforced: true,
            ...metadata,
          },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "LISTING",
          aggregateId: currentCase.targetId,
          eventType: restores ? "listing.appeal.restored" : "listing.appeal.upheld",
          payload: {
            schemaVersion: 1,
            aggregateVersion: input.nextListing.version,
            listingId: currentCase.targetId,
            type: listing.type,
            caseId: currentCase.id,
            appealId: appeal.id,
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
        action: {
          caseId: currentCase.id,
          actionId: action.id,
          action: input.action,
          reasonCode: input.reasonCode,
          currentCaseStatus: ModerationCaseStatus.RESOLVED,
          currentContentStatus: input.nextListing.status,
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
