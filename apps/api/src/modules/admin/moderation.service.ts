import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  ListModerationCasesQuery,
  ModerationActionRequest,
  ModerationActionResponse,
  ModerationCase,
  ModerationCaseCollection,
  ModerationCaseDetailResponse,
} from "@socal/contracts";
import {
  type ModerationActionKind,
  type ModerationCaseCursor,
  type ModerationCaseDetail,
  type ModerationCaseListItem,
} from "@socal/database/moderation-case";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { PolicyRequestContext } from "../../common/authorization/policy";
import {
  type ListingAggregate,
  type ListingTransitionCommand,
  ListingDomainError,
  transitionListing,
} from "../listings/listing-domain";
import { MODERATION_STORE, type ModerationStore } from "./moderation.store";

export class ModerationAccessDeniedError extends Error {
  constructor() {
    super("Moderation access denied");
    this.name = "ModerationAccessDeniedError";
  }
}

export class ModerationCaseNotFoundError extends Error {
  constructor() {
    super("Moderation case not found");
    this.name = "ModerationCaseNotFoundError";
  }
}

export class ModerationCursorError extends Error {
  constructor() {
    super("Moderation cursor is invalid");
    this.name = "ModerationCursorError";
  }
}

export class ModerationIdempotencyConflictError extends Error {
  constructor() {
    super("Moderation idempotency key conflict");
    this.name = "ModerationIdempotencyConflictError";
  }
}

export class ModerationStateConflictError extends Error {
  constructor(readonly currentVersion?: number) {
    super("Moderation case state conflict");
    this.name = "ModerationStateConflictError";
  }
}

export class ModerationValidationError extends Error {
  constructor() {
    super("Moderation action is invalid");
    this.name = "ModerationValidationError";
  }
}

type ModerationCursorPayload = {
  version: 1;
  actorUserId: string;
  queue: "listing-submission";
  status: string;
  riskTier: string | null;
  minPriority: number | null;
  priority: number;
  createdAt: string;
  id: string;
};

type NormalizedModerationQuery = {
  queue: "listing-submission";
  status: "OPEN" | "ASSIGNED" | "RESOLVED" | "APPEALED" | "CLOSED";
  riskTier?: "MEDIUM" | "HIGH";
  minPriority?: number;
  cursor?: string;
  limit: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reasonOptions = [
  { code: "CONTENT_POLICY_COMPLIANT", actions: ["APPROVE"] },
  { code: "NEEDS_CLARIFICATION", actions: ["REQUEST_CHANGES"] },
  { code: "PROHIBITED_CONTENT", actions: ["REJECT"] },
  { code: "EXTERNAL_PAYMENT_RISK", actions: ["REJECT"] },
  { code: "ESCALATE_SENIOR_REVIEW", actions: ["ESCALATE"] },
] as const;

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-moderation-case-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function actionHash(input: {
  caseId: string;
  expectedCaseVersion: number;
  action: ModerationActionRequest;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function actorIdentity(context: PolicyRequestContext): { userId: string; sessionId: string } {
  if (context.actor.kind === "guest") throw new ModerationAccessDeniedError();
  return { userId: context.actor.userId, sessionId: context.actor.sessionId };
}

export function moderationCaseEtag(version: number): string {
  return `"moderation-case-v${version}"`;
}

export function moderationCaseVersionFromEtag(value: string | undefined): number | null {
  const match = /^"moderation-case-v([1-9]\d*)"$/.exec(value ?? "");
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function slaDueAt(item: ModerationCaseListItem): Date {
  const milliseconds = item.riskTier === "HIGH" ? 15 * 60_000 : 4 * 60 * 60_000;
  return new Date(item.createdAt.getTime() + milliseconds);
}

function mapCase(item: ModerationCaseListItem, now: Date): ModerationCase {
  const dueAt = slaDueAt(item);
  return {
    id: item.id,
    targetType: "LISTING",
    targetId: item.targetId,
    queue: "listing-submission",
    priority: item.priority,
    riskTier: item.riskTier,
    status: item.status,
    version: item.version,
    listing: item.listing,
    ruleCodes: item.ruleCodes,
    slaDueAt: dueAt.toISOString(),
    isSlaBreached: now > dueAt && !["RESOLVED", "CLOSED"].includes(item.status),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function availableActions(detail: ModerationCaseDetail): ModerationActionKind[] {
  if (
    !["OPEN", "ASSIGNED"].includes(detail.item.status) ||
    detail.listing.status !== "SUBMITTED" ||
    !["PENDING_REVIEW", "ESCALATED"].includes(detail.listing.moderationStatus)
  ) {
    return [];
  }
  return detail.listing.moderationStatus === "ESCALATED"
    ? ["APPROVE", "REQUEST_CHANGES", "REJECT"]
    : ["APPROVE", "REQUEST_CHANGES", "REJECT", "ESCALATE"];
}

function snapshotDiff(
  snapshot: ModerationCaseDetail["snapshot"],
): ModerationCaseDetailResponse["data"]["diff"] {
  const fields: ReadonlyArray<[string, unknown]> = [
    ["title", snapshot.title],
    ["summary", snapshot.summary],
    ["body", snapshot.body],
    ["price", snapshot.price],
    ["attributes", snapshot.attributes],
    ["contactMode", snapshot.contactMode],
    ["locationPrecision", snapshot.locationPrecision],
    ["mediaIds", snapshot.mediaIds],
    ["category", snapshot.category],
    ["region", snapshot.region],
  ];
  return fields.flatMap(([field, after]) => {
    const before =
      snapshot.previous == null
        ? null
        : field === "locationPrecision"
          ? (snapshot.previous.location as { precision?: unknown } | null | undefined)?.precision
          : snapshot.previous[field];
    if (canonicalJson(before) === canonicalJson(after)) return [];
    return [
      {
        field,
        kind: before === null || before === undefined ? "ADDED" : "CHANGED",
        before: before ?? null,
        after,
      },
    ];
  });
}

function asListingAggregate(detail: ModerationCaseDetail): ListingAggregate {
  return {
    ...detail.listing,
    type: detail.listing.type,
    detail: detail.listing.detail,
    price: detail.listing.price
      ? {
          ...detail.listing.price,
          currency: "USD",
        }
      : null,
  } as ListingAggregate;
}

function transitionCommand(
  action: ModerationActionKind,
  detail: ModerationCaseDetail,
  actorUserId: string,
  expectedVersion: number,
  reasonCode: string,
  occurredAt: Date,
): ListingTransitionCommand {
  const metadata = { actorId: actorUserId, expectedVersion, reasonCode, occurredAt };
  switch (action) {
    case "APPROVE":
      if (
        detail.snapshot.revision?.classification === "MAJOR_EDIT" &&
        detail.snapshot.revision.originalPublishedAt &&
        detail.snapshot.revision.originalExpiresAt
      ) {
        return {
          kind: "MODERATOR_APPROVE_REVISION",
          originalPublishedAt: new Date(detail.snapshot.revision.originalPublishedAt),
          originalExpiresAt: new Date(detail.snapshot.revision.originalExpiresAt),
          ...metadata,
        };
      }
      return {
        kind: "MODERATOR_APPROVE",
        lifetimeDays: detail.snapshot.defaultLifetimeDays,
        ...metadata,
      };
    case "REQUEST_CHANGES":
      return { kind: "REJECT_TO_DRAFT", ...metadata };
    case "REJECT":
      return { kind: "SUSPEND", ...metadata };
    case "ESCALATE":
      return { kind: "ESCALATE", ...metadata };
  }
}

@Injectable()
export class ModerationService {
  readonly #cursorSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MODERATION_STORE) private readonly store: ModerationStore,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async list(
    context: PolicyRequestContext,
    query: ListModerationCasesQuery,
    now = new Date(),
  ): Promise<ModerationCaseCollection> {
    const actor = actorIdentity(context);
    const normalized: NormalizedModerationQuery = {
      queue: query.queue ?? "listing-submission",
      status: query.status ?? "OPEN",
      ...(query.riskTier ? { riskTier: query.riskTier } : {}),
      ...(query.minPriority === undefined ? {} : { minPriority: query.minPriority }),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit ?? 20,
    };
    const cursor = normalized.cursor
      ? this.#decodeCursor(normalized.cursor, actor.userId, normalized)
      : undefined;
    const result = await this.store.list({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      queue: normalized.queue,
      status: normalized.status,
      ...(normalized.riskTier ? { riskTier: normalized.riskTier } : {}),
      ...(normalized.minPriority === undefined ? {} : { minPriority: normalized.minPriority }),
      ...(cursor ? { cursor } : {}),
      limit: normalized.limit,
      now,
    });
    if (result.kind === "actor_unavailable") throw new ModerationAccessDeniedError();
    return {
      data: result.items.map((item) => mapCase(item, now)),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? this.#encodeCursor(actor.userId, normalized, result.nextCursor)
          : null,
      },
      generatedAt: now.toISOString(),
    };
  }

  async get(
    context: PolicyRequestContext,
    caseId: string,
    now = new Date(),
  ): Promise<ModerationCaseDetailResponse> {
    return this.#getDetail(context, caseId, now).then((detail) => ({
      data: {
        case: mapCase(detail.item, now),
        snapshot: detail.snapshot,
        diff: snapshotDiff(detail.snapshot),
        rules: detail.rules.map((rule) => ({
          ...rule,
          severity: rule.severity,
        })),
        media: detail.media.map((media) => ({
          ...media,
          updatedAt: media.updatedAt.toISOString(),
        })),
        publisherHistory: detail.publisherHistory,
        availableActions: availableActions(detail),
        reasonOptions: [...reasonOptions],
        generatedAt: now.toISOString(),
        source: "POSTGRESQL",
      },
    }));
  }

  async act(
    context: PolicyRequestContext,
    caseId: string,
    expectedCaseVersion: number,
    idempotencyKey: string,
    input: ModerationActionRequest,
    now = new Date(),
  ): Promise<ModerationActionResponse> {
    const actor = actorIdentity(context);
    const detail = await this.#getDetail(context, caseId, now);
    let nextListing: {
      status: ListingAggregate["status"];
      moderationStatus: ListingAggregate["moderationStatus"];
      publishedAt: Date | null;
      expiresAt: Date | null;
      version: number;
    };
    let transitionFailed = false;
    try {
      const transition = transitionListing(
        asListingAggregate(detail),
        transitionCommand(
          input.action,
          detail,
          actor.userId,
          detail.listing.version,
          input.reasonCode,
          now,
        ),
      );
      nextListing = {
        status: transition.listing.status,
        moderationStatus: transition.listing.moderationStatus,
        publishedAt: transition.listing.publishedAt,
        expiresAt: transition.listing.expiresAt,
        version: transition.listing.version,
      };
    } catch (error) {
      if (!(error instanceof ListingDomainError)) throw error;
      transitionFailed = true;
      nextListing = {
        status: detail.listing.status,
        moderationStatus: detail.listing.moderationStatus,
        publishedAt: detail.listing.publishedAt,
        expiresAt: detail.listing.expiresAt,
        version: detail.listing.version + 1,
      };
    }
    const result = await this.store.commit({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      recentMfaAfter: new Date(now.getTime() - this.environment.ADMIN_STEP_UP_TTL_SECONDS * 1_000),
      caseId,
      expectedCaseVersion,
      expectedListingVersion: detail.listing.version,
      action: input.action,
      reasonCode: input.reasonCode,
      ...(input.note ? { note: input.note } : {}),
      idempotencyKey,
      requestHash: actionHash({ caseId, expectedCaseVersion, action: input }),
      requestId: context.requestId,
      occurredAt: now,
      nextListing,
    });
    if (result.kind === "actor_unavailable") throw new ModerationAccessDeniedError();
    if (result.kind === "idempotency_conflict") {
      throw new ModerationIdempotencyConflictError();
    }
    if (result.kind === "not_found") throw new ModerationCaseNotFoundError();
    if (result.kind === "version_conflict") {
      throw new ModerationStateConflictError(result.currentCaseVersion);
    }
    if (result.kind === "state_conflict" || result.kind === "time_conflict") {
      if (transitionFailed) throw new ModerationValidationError();
      throw new ModerationStateConflictError(result.currentCaseVersion);
    }
    if (result.kind !== "committed" && result.kind !== "exact_retry") {
      throw new ModerationStateConflictError();
    }
    return {
      data: {
        ...result.action,
        occurredAt: result.action.occurredAt.toISOString(),
      },
    };
  }

  async #getDetail(
    context: PolicyRequestContext,
    caseId: string,
    now: Date,
  ): Promise<ModerationCaseDetail> {
    const actor = actorIdentity(context);
    const result = await this.store.get({
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      caseId,
      now,
    });
    if (result.kind === "actor_unavailable") throw new ModerationAccessDeniedError();
    if (result.kind === "not_found") throw new ModerationCaseNotFoundError();
    if (result.kind !== "found") throw new ModerationCaseNotFoundError();
    return result.detail;
  }

  #encodeCursor(
    actorUserId: string,
    query: NormalizedModerationQuery,
    cursor: ModerationCaseCursor,
  ): string {
    const payload: ModerationCursorPayload = {
      version: 1,
      actorUserId,
      queue: query.queue,
      status: query.status,
      riskTier: query.riskTier ?? null,
      minPriority: query.minPriority ?? null,
      priority: cursor.priority,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${cursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodeCursor(
    value: string,
    actorUserId: string,
    query: NormalizedModerationQuery,
  ): ModerationCaseCursor {
    const [encoded, signature, extra] = value.split(".");
    if (!encoded || !signature || extra) throw new ModerationCursorError();
    if (!signaturesMatch(cursorSignature(this.#cursorSecret, encoded), signature)) {
      throw new ModerationCursorError();
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<ModerationCursorPayload>;
      const createdAt = new Date(payload.createdAt ?? "");
      if (
        payload.version !== 1 ||
        payload.actorUserId !== actorUserId ||
        payload.queue !== query.queue ||
        payload.status !== query.status ||
        payload.riskTier !== (query.riskTier ?? null) ||
        payload.minPriority !== (query.minPriority ?? null) ||
        !Number.isInteger(payload.priority) ||
        (payload.priority ?? -1) < 0 ||
        (payload.priority ?? 101) > 100 ||
        !uuidPattern.test(payload.id ?? "") ||
        !Number.isFinite(createdAt.getTime())
      ) {
        throw new ModerationCursorError();
      }
      return { priority: payload.priority!, createdAt, id: payload.id! };
    } catch (error) {
      if (error instanceof ModerationCursorError) throw error;
      throw new ModerationCursorError();
    }
  }
}
