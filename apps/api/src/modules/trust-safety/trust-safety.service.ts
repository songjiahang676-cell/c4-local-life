import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  AppealModerationActionRequest,
  AppealModerationCaseCollection,
  AppealModerationCaseDetailResponse,
  CreateModerationAppealRequest,
  CreateReportRequest,
  ListAppealModerationCasesQuery,
  ListReportModerationCasesQuery,
  ModerationAppealReceiptResponse,
  ReportModerationActionRequest,
  ReportModerationCaseCollection,
  ReportModerationCaseDetailResponse,
  ReportReceiptResponse,
  TrustSafetyActionResponse,
} from "@socal/contracts";
import type {
  AppealCaseDetailRecord,
  AppealCaseListItem,
  ReportCaseDetailRecord,
  ReportCaseListItem,
  TrustSafetyCursor,
  TrustSafetyListingState,
} from "@socal/database/trust-safety";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { PolicyRequestContext } from "../../common/authorization/policy";
import { TRUST_SAFETY_STORE, type TrustSafetyStore } from "./trust-safety.store";

export class TrustSafetyAccessDeniedError extends Error {
  constructor() {
    super("Trust and safety access denied");
    this.name = "TrustSafetyAccessDeniedError";
  }
}

export class TrustSafetyNotFoundError extends Error {
  constructor() {
    super("Trust and safety resource not found");
    this.name = "TrustSafetyNotFoundError";
  }
}

export class TrustSafetyCursorError extends Error {
  constructor() {
    super("Trust and safety cursor is invalid");
    this.name = "TrustSafetyCursorError";
  }
}

export class TrustSafetyIdempotencyConflictError extends Error {
  constructor() {
    super("Trust and safety idempotency conflict");
    this.name = "TrustSafetyIdempotencyConflictError";
  }
}

export class TrustSafetyStateConflictError extends Error {
  constructor(readonly currentVersion?: number) {
    super("Trust and safety state conflict");
    this.name = "TrustSafetyStateConflictError";
  }
}

export class TrustSafetyValidationError extends Error {
  constructor() {
    super("Trust and safety input is invalid for the current state");
    this.name = "TrustSafetyValidationError";
  }
}

export class TrustSafetyRateLimitError extends Error {
  constructor() {
    super("Report rate limit exceeded");
    this.name = "TrustSafetyRateLimitError";
  }
}

type CursorPayload = {
  version: 1;
  actorUserId: string;
  queue: "listing-report" | "listing-appeal";
  status: string;
  priority: number;
  createdAt: string;
  id: string;
};

const reportReasonOptions = [
  {
    code: "NOT_A_VIOLATION",
    actions: ["DISMISS"],
  },
  {
    code: "DUPLICATE_REPORT",
    actions: ["DISMISS"],
  },
  {
    code: "INSUFFICIENT_EVIDENCE",
    actions: ["DISMISS"],
  },
  {
    code: "CONFIRMED_SCAM",
    actions: ["REMOVE_CONTENT"],
  },
  {
    code: "PROHIBITED_CONTENT",
    actions: ["REMOVE_CONTENT"],
  },
  {
    code: "MISLEADING_CONTENT",
    actions: ["REMOVE_CONTENT"],
  },
  {
    code: "PRIVACY_VIOLATION",
    actions: ["REMOVE_CONTENT"],
  },
  {
    code: "ESCALATE_SENIOR_REVIEW",
    actions: ["ESCALATE"],
  },
] as const;
const appealReasonOptions = [
  { code: "ACTION_CONFIRMED", actions: ["UPHOLD"] },
  { code: "ACTION_OVERTURNED", actions: ["RESTORE"] },
] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actorIdentity(context: PolicyRequestContext): { userId: string; sessionId: string } {
  if (context.actor.kind === "guest") throw new TrustSafetyAccessDeniedError();
  return { userId: context.actor.userId, sessionId: context.actor.sessionId };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function signature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-trust-safety-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeCursor(secret: string, payload: CursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(secret, encoded)}`;
}

function decodeCursor(
  secret: string,
  value: string | undefined,
  expected: Pick<CursorPayload, "actorUserId" | "queue" | "status">,
): TrustSafetyCursor | undefined {
  if (!value) return undefined;
  const [encoded, provided, extra] = value.split(".");
  if (!encoded || !provided || extra || !signaturesMatch(signature(secret, encoded), provided)) {
    throw new TrustSafetyCursorError();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new TrustSafetyCursorError();
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new TrustSafetyCursorError();
  }
  const candidate = payload as Partial<CursorPayload>;
  const createdAt = new Date(candidate.createdAt ?? "");
  if (
    candidate.version !== 1 ||
    candidate.actorUserId !== expected.actorUserId ||
    candidate.queue !== expected.queue ||
    candidate.status !== expected.status ||
    typeof candidate.priority !== "number" ||
    !Number.isInteger(candidate.priority) ||
    candidate.priority < 0 ||
    candidate.priority > 100 ||
    !uuidPattern.test(candidate.id ?? "") ||
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== candidate.createdAt
  ) {
    throw new TrustSafetyCursorError();
  }
  return { priority: candidate.priority, createdAt, id: candidate.id as string };
}

function reportSlaDueAt(item: ReportCaseListItem): Date {
  return new Date(item.createdAt.getTime() + 24 * 60 * 60_000);
}

function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function mapReportCase(
  item: ReportCaseListItem,
  now: Date,
): ReportModerationCaseCollection["data"][number] {
  const dueAt = reportSlaDueAt(item);
  return {
    ...item,
    slaDueAt: dueAt.toISOString(),
    isSlaBreached: now > dueAt && item.caseStatus !== "RESOLVED" && item.caseStatus !== "CLOSED",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function mapAppealCase(
  item: AppealCaseListItem,
  now: Date,
): AppealModerationCaseCollection["data"][number] {
  const dueAt = addBusinessDays(item.createdAt, 3);
  return {
    ...item,
    slaDueAt: dueAt.toISOString(),
    isSlaBreached: now > dueAt && item.caseStatus !== "RESOLVED" && item.caseStatus !== "CLOSED",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function reportActions(
  detail: ReportCaseDetailRecord,
): ("DISMISS" | "REMOVE_CONTENT" | "ESCALATE")[] {
  if (detail.item.caseStatus !== "OPEN" && detail.item.caseStatus !== "ASSIGNED") {
    return [];
  }
  if (
    detail.listing.status === "PUBLISHED" &&
    (detail.listing.moderationStatus === "AUTO_APPROVED" ||
      detail.listing.moderationStatus === "APPROVED")
  ) {
    return ["DISMISS", "REMOVE_CONTENT", "ESCALATE"];
  }
  return ["DISMISS", "ESCALATE"];
}

function appealActions(
  detail: AppealCaseDetailRecord,
  actorUserId: string,
  now: Date,
): ("UPHOLD" | "RESTORE")[] {
  if (
    detail.item.caseStatus !== "OPEN" ||
    detail.item.appealStatus !== "OPEN" ||
    detail.originalAction.actorId === actorUserId ||
    detail.listing.status !== "SUSPENDED" ||
    detail.listing.moderationStatus !== "REJECTED"
  ) {
    return [];
  }
  return detail.listing.expiresAt && now < detail.listing.expiresAt
    ? ["UPHOLD", "RESTORE"]
    : ["UPHOLD"];
}

function unchangedListing(listing: TrustSafetyListingState): {
  status: TrustSafetyListingState["status"];
  moderationStatus: TrustSafetyListingState["moderationStatus"];
  publishedAt: Date | null;
  expiresAt: Date | null;
  version: number;
} {
  return {
    status: listing.status,
    moderationStatus: listing.moderationStatus,
    publishedAt: listing.publishedAt,
    expiresAt: listing.expiresAt,
    version: listing.version,
  };
}

export function trustSafetyCaseEtag(version: number): string {
  return `"trust-safety-case-v${version}"`;
}

export function trustSafetyCaseVersionFromEtag(value: string | undefined): number | null {
  const match = /^"trust-safety-case-v([1-9]\d*)"$/.exec(value ?? "");
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

@Injectable()
export class TrustSafetyService {
  readonly #cursorSecret: string;

  constructor(
    @Inject(TRUST_SAFETY_STORE) private readonly store: TrustSafetyStore,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async createReport(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateReportRequest,
    now = new Date(),
  ): Promise<ReportReceiptResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createReport({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      targetId: input.targetId,
      reasonCode: input.reasonCode,
      ...(input.details ? { details: input.details } : {}),
      idempotencyKey,
      requestHash: requestHash({ input }),
      requestId: context.requestId,
      occurredAt: now,
    });
    if (result.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    if (result.kind === "idempotency_conflict") {
      throw new TrustSafetyIdempotencyConflictError();
    }
    if (result.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (result.kind === "rate_limited") throw new TrustSafetyRateLimitError();
    if (result.kind === "self_report_forbidden") throw new TrustSafetyValidationError();
    if (!("receipt" in result)) throw new TrustSafetyStateConflictError();
    return {
      data: {
        id: result.receipt.id,
        targetType: "LISTING",
        targetId: result.receipt.targetId,
        reasonCode: result.receipt.reasonCode,
        status: result.receipt.status,
        deduplicated: result.receipt.deduplicated,
        submittedAt: result.receipt.submittedAt.toISOString(),
      },
    };
  }

  async createAppeal(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateModerationAppealRequest,
    now = new Date(),
  ): Promise<ModerationAppealReceiptResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createAppeal({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      moderationActionId: input.moderationActionId,
      statement: input.statement,
      idempotencyKey,
      requestHash: requestHash({ input }),
      requestId: context.requestId,
      occurredAt: now,
    });
    if (result.kind === "actor_unavailable" || result.kind === "not_owner") {
      throw new TrustSafetyAccessDeniedError();
    }
    if (result.kind === "idempotency_conflict") {
      throw new TrustSafetyIdempotencyConflictError();
    }
    if (result.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (result.kind === "appeal_expired") throw new TrustSafetyValidationError();
    if (result.kind === "state_conflict") throw new TrustSafetyStateConflictError();
    if (!("receipt" in result)) throw new TrustSafetyStateConflictError();
    return {
      data: {
        id: result.receipt.id,
        moderationActionId: result.receipt.moderationActionId,
        status: "OPEN",
        appealDeadline: result.receipt.appealDeadline.toISOString(),
        deduplicated: result.receipt.deduplicated,
        submittedAt: result.receipt.submittedAt.toISOString(),
      },
    };
  }

  async listReports(
    context: PolicyRequestContext,
    query: ListReportModerationCasesQuery,
    now = new Date(),
  ): Promise<ReportModerationCaseCollection> {
    const actor = actorIdentity(context);
    const status = query.status ?? "OPEN";
    const result = await this.store.listReports({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      status,
      cursor: decodeCursor(this.#cursorSecret, query.cursor, {
        actorUserId: actor.userId,
        queue: "listing-report",
        status,
      }),
      limit: query.limit ?? 20,
      now,
    });
    if (result.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    return {
      data: result.items.map((item) => mapReportCase(item, now)),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? encodeCursor(this.#cursorSecret, {
              version: 1,
              actorUserId: actor.userId,
              queue: "listing-report",
              status,
              ...result.nextCursor,
              createdAt: result.nextCursor.createdAt.toISOString(),
            })
          : null,
      },
      generatedAt: now.toISOString(),
    };
  }

  async listAppeals(
    context: PolicyRequestContext,
    query: ListAppealModerationCasesQuery,
    now = new Date(),
  ): Promise<AppealModerationCaseCollection> {
    const actor = actorIdentity(context);
    const status = query.status ?? "OPEN";
    const result = await this.store.listAppeals({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      status,
      cursor: decodeCursor(this.#cursorSecret, query.cursor, {
        actorUserId: actor.userId,
        queue: "listing-appeal",
        status,
      }),
      limit: query.limit ?? 20,
      now,
    });
    if (result.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    return {
      data: result.items.map((item) => mapAppealCase(item, now)),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? encodeCursor(this.#cursorSecret, {
              version: 1,
              actorUserId: actor.userId,
              queue: "listing-appeal",
              status,
              ...result.nextCursor,
              createdAt: result.nextCursor.createdAt.toISOString(),
            })
          : null,
      },
      generatedAt: now.toISOString(),
    };
  }

  async getReport(
    context: PolicyRequestContext,
    reportId: string,
    now = new Date(),
  ): Promise<ReportModerationCaseDetailResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.getReport({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      reportId,
      now,
    });
    if (result.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    if (result.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (!("detail" in result)) throw new TrustSafetyStateConflictError();
    return {
      data: {
        case: mapReportCase(result.detail.item, now),
        reporterStatement: result.detail.reporterStatement,
        snapshot: result.detail.snapshot,
        snapshotHash: result.detail.snapshotHash,
        evidenceCapturedAt: result.detail.evidenceCapturedAt.toISOString(),
        availableActions: reportActions(result.detail),
        reasonOptions: [...reportReasonOptions],
        actionHistory: result.detail.actions.map((action) => ({
          ...action,
          createdAt: action.createdAt.toISOString(),
        })),
        generatedAt: now.toISOString(),
        source: "POSTGRESQL",
      },
    };
  }

  async getAppeal(
    context: PolicyRequestContext,
    appealId: string,
    now = new Date(),
  ): Promise<AppealModerationCaseDetailResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.getAppeal({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      appealId,
      now,
    });
    if (result.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    if (result.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (!("detail" in result)) throw new TrustSafetyStateConflictError();
    return {
      data: {
        case: mapAppealCase(result.detail.item, now),
        statement: result.detail.statement,
        originalAction: {
          id: result.detail.originalAction.id,
          action: "REMOVE_CONTENT",
          reasonCode: result.detail.originalAction.reasonCode,
          occurredAt: result.detail.originalAction.occurredAt.toISOString(),
        },
        snapshot: result.detail.snapshot,
        snapshotHash: result.detail.snapshotHash,
        evidenceCapturedAt: result.detail.evidenceCapturedAt.toISOString(),
        availableActions: appealActions(result.detail, actor.userId, now),
        reasonOptions: [...appealReasonOptions],
        actionHistory: result.detail.actions.map((action) => ({
          ...action,
          createdAt: action.createdAt.toISOString(),
        })),
        generatedAt: now.toISOString(),
        source: "POSTGRESQL",
      },
    };
  }

  async actOnReport(
    context: PolicyRequestContext,
    reportId: string,
    expectedCaseVersion: number,
    idempotencyKey: string,
    input: ReportModerationActionRequest,
    now = new Date(),
  ): Promise<TrustSafetyActionResponse> {
    const actor = actorIdentity(context);
    const detail = await this.store.getReport({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      reportId,
      now,
    });
    if (detail.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    if (detail.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (!("detail" in detail)) throw new TrustSafetyStateConflictError();
    const removes = input.action === "REMOVE_CONTENT";
    if (
      removes &&
      (detail.detail.listing.status !== "PUBLISHED" ||
        (detail.detail.listing.moderationStatus !== "AUTO_APPROVED" &&
          detail.detail.listing.moderationStatus !== "APPROVED"))
    ) {
      throw new TrustSafetyValidationError();
    }
    const nextListing = removes
      ? {
          status: "SUSPENDED" as const,
          moderationStatus: "REJECTED" as const,
          publishedAt: detail.detail.listing.publishedAt,
          expiresAt: detail.detail.listing.expiresAt,
          version: detail.detail.listing.version + 1,
        }
      : unchangedListing(detail.detail.listing);
    const result = await this.store.commitReportAction({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      recentMfaAfter: new Date(now.getTime() - this.environment.ADMIN_STEP_UP_TTL_SECONDS * 1_000),
      reportId,
      expectedCaseVersion,
      expectedListingVersion: detail.detail.listing.version,
      action: input.action,
      reasonCode: input.reasonCode,
      ...(input.note ? { note: input.note } : {}),
      idempotencyKey,
      requestHash: requestHash({ reportId, expectedCaseVersion, input }),
      requestId: context.requestId,
      occurredAt: now,
      nextListing,
    });
    return this.#actionResult(result);
  }

  async actOnAppeal(
    context: PolicyRequestContext,
    appealId: string,
    expectedCaseVersion: number,
    idempotencyKey: string,
    input: AppealModerationActionRequest,
    now = new Date(),
  ): Promise<TrustSafetyActionResponse> {
    const actor = actorIdentity(context);
    const detail = await this.store.getAppeal({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      appealId,
      now,
    });
    if (detail.kind === "actor_unavailable") throw new TrustSafetyAccessDeniedError();
    if (detail.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (!("detail" in detail)) throw new TrustSafetyStateConflictError();
    if (detail.detail.originalAction.actorId === actor.userId) {
      throw new TrustSafetyAccessDeniedError();
    }
    const restores = input.action === "RESTORE";
    if (
      detail.detail.listing.status !== "SUSPENDED" ||
      detail.detail.listing.moderationStatus !== "REJECTED" ||
      (restores && (!detail.detail.listing.expiresAt || now >= detail.detail.listing.expiresAt))
    ) {
      throw new TrustSafetyValidationError();
    }
    const nextListing = restores
      ? {
          status: "PUBLISHED" as const,
          moderationStatus: "APPROVED" as const,
          publishedAt: detail.detail.listing.publishedAt,
          expiresAt: detail.detail.listing.expiresAt,
          version: detail.detail.listing.version + 1,
        }
      : unchangedListing(detail.detail.listing);
    const result = await this.store.commitAppealAction({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      recentMfaAfter: new Date(now.getTime() - this.environment.ADMIN_STEP_UP_TTL_SECONDS * 1_000),
      appealId,
      expectedCaseVersion,
      expectedListingVersion: detail.detail.listing.version,
      action: input.action,
      reasonCode: input.reasonCode,
      ...(input.note ? { note: input.note } : {}),
      idempotencyKey,
      requestHash: requestHash({ appealId, expectedCaseVersion, input }),
      requestId: context.requestId,
      occurredAt: now,
      nextListing,
    });
    return this.#actionResult(result);
  }

  #actionResult(
    result: Awaited<ReturnType<TrustSafetyStore["commitReportAction"]>>,
  ): TrustSafetyActionResponse {
    if (result.kind === "actor_unavailable" || result.kind === "same_reviewer") {
      throw new TrustSafetyAccessDeniedError();
    }
    if (result.kind === "idempotency_conflict") {
      throw new TrustSafetyIdempotencyConflictError();
    }
    if (result.kind === "not_found") throw new TrustSafetyNotFoundError();
    if (
      result.kind === "state_conflict" ||
      result.kind === "time_conflict" ||
      result.kind === "version_conflict"
    ) {
      throw new TrustSafetyStateConflictError(result.currentCaseVersion);
    }
    if (!("action" in result)) throw new TrustSafetyStateConflictError();
    return {
      data: {
        ...result.action,
        occurredAt: result.action.occurredAt.toISOString(),
      },
    };
  }
}
