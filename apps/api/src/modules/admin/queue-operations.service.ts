import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  AdminJob,
  AdminJobResponse,
  CreateQueueReconciliationRunRequest,
  CreateQueueReplayBatchRequest,
  ListQueueDeadLettersQuery,
  QueueDeadLetterCollection,
} from "@socal/contracts";
import type {
  QueueAdminJobProjection,
  QueueDeadLetterCursor,
} from "@socal/database/queue-operations";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { PolicyRequestContext } from "../../common/authorization/policy";
import { QUEUE_OPERATIONS_STORE, type QueueOperationsStore } from "./queue-operations.store";

export class QueueOperationsAccessDeniedError extends Error {}
export class QueueOperationsCursorError extends Error {}
export class QueueOperationsIdempotencyConflictError extends Error {}
export class QueueOperationsInvalidTargetError extends Error {}
export class QueueOperationsJobNotFoundError extends Error {}

type CursorPayload = {
  version: 1;
  actorUserId: string;
  source: "OUTBOX" | "QUEUE" | null;
  eventType: string | null;
  failureCode: string | null;
  failedAt: string;
  id: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function actorIdentity(context: PolicyRequestContext): { userId: string } {
  if (context.actor.kind === "guest") throw new QueueOperationsAccessDeniedError();
  return { userId: context.actor.userId };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function mapJob(job: QueueAdminJobProjection): AdminJob {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    dryRun: job.dryRun,
    estimatedItems: job.estimatedItems,
    processedItems: job.processedItems,
    succeededItems: job.succeededItems,
    skippedItems: job.skippedItems,
    failedItems: job.failedItems,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function signature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-queue-dead-letter-cursor-v1\0", "utf8")
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

@Injectable()
export class QueueOperationsService {
  readonly #cursorSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(QUEUE_OPERATIONS_STORE) private readonly store: QueueOperationsStore,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async listDeadLetters(
    context: PolicyRequestContext,
    query: ListQueueDeadLettersQuery,
    now = new Date(),
  ): Promise<QueueDeadLetterCollection> {
    const actor = actorIdentity(context);
    const cursor = query.cursor ? this.#decodeCursor(query.cursor, actor.userId, query) : undefined;
    const result = await this.store.listDeadLetters({
      ...(query.source ? { source: query.source } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.failureCode ? { failureCode: query.failureCode } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit ?? 20,
    });
    return {
      data: result.items.map((item) => ({
        ...item,
        failedAt: item.failedAt.toISOString(),
      })),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? this.#encodeCursor(actor.userId, query, result.nextCursor)
          : null,
      },
      generatedAt: now.toISOString(),
    };
  }

  async createReplayBatch(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateQueueReplayBatchRequest,
    now = new Date(),
  ): Promise<AdminJobResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createReplayJob({
      actorUserId: actor.userId,
      idempotencyKey,
      requestHash: requestHash(input),
      requestId: context.requestId,
      reasonCode: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      targets: input.targets,
      occurredAt: now,
    });
    return this.#mapCreateResult(result);
  }

  async createReconciliationRun(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateQueueReconciliationRunRequest,
    now = new Date(),
  ): Promise<AdminJobResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createReconciliationJob({
      actorUserId: actor.userId,
      idempotencyKey,
      requestHash: requestHash(input),
      requestId: context.requestId,
      reasonCode: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      dryRun: input.dryRun,
      maxItems: input.maxItems,
      occurredAt: now,
    });
    return this.#mapCreateResult(result);
  }

  async getJob(context: PolicyRequestContext, jobId: string): Promise<AdminJobResponse> {
    actorIdentity(context);
    const job = await this.store.getJob(jobId);
    if (!job) throw new QueueOperationsJobNotFoundError();
    return { data: mapJob(job) };
  }

  #mapCreateResult(
    result: Awaited<ReturnType<QueueOperationsStore["createReplayJob"]>>,
  ): AdminJobResponse {
    if (result.kind === "idempotency_conflict") {
      throw new QueueOperationsIdempotencyConflictError();
    }
    if (result.kind === "invalid_targets") throw new QueueOperationsInvalidTargetError();
    return { data: mapJob(result.job) };
  }

  #encodeCursor(
    actorUserId: string,
    query: ListQueueDeadLettersQuery,
    cursor: QueueDeadLetterCursor,
  ): string {
    const payload: CursorPayload = {
      version: 1,
      actorUserId,
      source: query.source ?? null,
      eventType: query.eventType ?? null,
      failureCode: query.failureCode ?? null,
      failedAt: cursor.failedAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${signature(this.#cursorSecret, encoded)}`;
  }

  #decodeCursor(
    value: string,
    actorUserId: string,
    query: ListQueueDeadLettersQuery,
  ): QueueDeadLetterCursor {
    const [encoded, provided, extra] = value.split(".");
    if (
      !encoded ||
      !provided ||
      extra ||
      !signaturesMatch(signature(this.#cursorSecret, encoded), provided)
    ) {
      throw new QueueOperationsCursorError();
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      const failedAt = new Date(payload.failedAt ?? "");
      if (
        payload.version !== 1 ||
        payload.actorUserId !== actorUserId ||
        payload.source !== (query.source ?? null) ||
        payload.eventType !== (query.eventType ?? null) ||
        payload.failureCode !== (query.failureCode ?? null) ||
        !uuidPattern.test(payload.id ?? "") ||
        !Number.isFinite(failedAt.getTime())
      ) {
        throw new QueueOperationsCursorError();
      }
      return { failedAt, id: payload.id! };
    } catch (error) {
      if (error instanceof QueueOperationsCursorError) throw error;
      throw new QueueOperationsCursorError();
    }
  }
}
