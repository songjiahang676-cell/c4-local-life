import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AdminJobItemStatus,
  AdminJobStatus,
  AdminJobType,
  OutboxStatus,
  Prisma,
  PrismaClient,
  QueueDeadLetterStatus,
} from "../../generated/prisma/client";
import type { DeadLetterSource } from "../../generated/prisma/client";

export type QueueOperationsRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type QueueDeadLetterCursor = {
  failedAt: Date;
  id: string;
};

export type QueueDeadLetterProjection = {
  id: string;
  eventId: string;
  source: "OUTBOX" | "QUEUE";
  queueName: string;
  eventType: string;
  attemptCount: number;
  failureCode: string;
  status: "OPEN" | "REPLAY_PENDING" | "RESOLVED";
  failedAt: Date;
};

export type ListQueueDeadLettersInput = {
  source?: QueueDeadLetterProjection["source"];
  eventType?: string;
  failureCode?: string;
  cursor?: QueueDeadLetterCursor;
  limit: number;
};

export type ListQueueDeadLettersResult = {
  items: QueueDeadLetterProjection[];
  nextCursor: QueueDeadLetterCursor | null;
};

export type QueueReplayTarget = {
  source: "OUTBOX" | "QUEUE";
  targetId: string;
};

export type CreateQueueReplayJobInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  reasonCode: string;
  ticketRef?: string;
  targets: readonly QueueReplayTarget[];
  occurredAt: Date;
};

export type CreateQueueReconciliationJobInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  reasonCode: string;
  ticketRef?: string;
  dryRun: boolean;
  maxItems: number;
  occurredAt: Date;
};

export type QueueAdminJobProjection = {
  id: string;
  type: "QUEUE_REPLAY" | "QUEUE_RECONCILIATION";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  dryRun: boolean;
  estimatedItems: number;
  processedItems: number;
  succeededItems: number;
  skippedItems: number;
  failedItems: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type CreateQueueAdminJobResult =
  | { kind: "created" | "exact_retry"; job: QueueAdminJobProjection }
  | { kind: "idempotency_conflict" }
  | { kind: "invalid_targets" };

export type ClaimedQueueAdminJob = QueueAdminJobProjection & {
  actorUserId: string;
  reasonCode: string;
  ticketRef: string | null;
  leaseExpiresAt: Date;
};

export type QueueAdminJobItem = {
  id: string;
  jobId: string;
  source: "OUTBOX" | "QUEUE";
  targetId: string;
  status: "PENDING" | "SUCCEEDED" | "SKIPPED" | "FAILED";
};

export type QueueDeadLetterInternal = QueueDeadLetterProjection & {
  aggregateType: string;
  aggregateId: string;
  payloadHash: string;
};

export type CanonicalOutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

export type RecordQueueDeadLetterInput = {
  eventId: string;
  queueName: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  attemptCount: number;
  failureCode: string;
  payloadHash: string;
  failedAt: Date;
};

type QueueOperationsClient = PrismaClient | Prisma.TransactionClient;

type DeadLetterRow = {
  id: string;
  eventId: string;
  source: "OUTBOX" | "QUEUE";
  queueName: string;
  eventType: string;
  attemptCount: number;
  failureCode: string;
  status: "OPEN" | "REPLAY_PENDING" | "RESOLVED";
  failedAt: Date;
};

function isRepositoryOptions(
  target: QueueOperationsClient | QueueOperationsRepositoryOptions,
): target is QueueOperationsRepositoryOptions {
  return "connectionString" in target;
}

function assertBoundedInteger(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
}

function boundedCode(value: string, fallback: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{1,119}$/.test(normalized) ? normalized : fallback;
}

async function lockIdempotencyKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  type: AdminJobType,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${"queue-admin-job-v1"} || ':' || ${actorUserId} || ':' || ${type}::text || ':' || ${idempotencyKey},
        0
      )
    )`,
  );
}

function mapJob(row: {
  id: string;
  type: AdminJobType;
  status: AdminJobStatus;
  dryRun: boolean;
  estimatedItems: number;
  processedItems: number;
  succeededItems: number;
  skippedItems: number;
  failedItems: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): QueueAdminJobProjection {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    dryRun: row.dryRun,
    estimatedItems: row.estimatedItems,
    processedItems: row.processedItems,
    succeededItems: row.succeededItems,
    skippedItems: row.skippedItems,
    failedItems: row.failedItems,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

const jobProjectionSelect = {
  id: true,
  type: true,
  status: true,
  dryRun: true,
  estimatedItems: true,
  processedItems: true,
  succeededItems: true,
  skippedItems: true,
  failedItems: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const;

export class QueueOperationsRepository {
  readonly #client: QueueOperationsClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: QueueOperationsClient | QueueOperationsRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
    } else {
      this.#client = target;
      this.#ownedClient = null;
    }
  }

  async listDeadLetters(input: ListQueueDeadLettersInput): Promise<ListQueueDeadLettersResult> {
    assertBoundedInteger(input.limit, 50, "limit");
    const includeOutbox = input.source !== "QUEUE";
    const includeQueue = input.source !== "OUTBOX";
    const eventType = input.eventType ?? null;
    const failureCode = input.failureCode ?? null;
    const cursorDate = input.cursor?.failedAt ?? null;
    const cursorId = input.cursor?.id ?? null;
    const rows = await this.#client.$queryRaw<DeadLetterRow[]>(Prisma.sql`
      WITH dead_letters AS (
        SELECT
          event."id",
          event."id" AS "eventId",
          'OUTBOX'::text AS "source",
          'socal-outbox'::text AS "queueName",
          event."event_type" AS "eventType",
          event."attempts" AS "attemptCount",
          CASE
            WHEN event."last_error" ~ '^[A-Z][A-Z0-9_.-]{1,119}$' THEN event."last_error"
            ELSE 'OUTBOX_PUBLISH_FAILED'
          END AS "failureCode",
          'OPEN'::text AS "status",
          event."available_at" AS "failedAt"
        FROM "outbox_events" event
        WHERE ${includeOutbox}
          AND event."status" = 'FAILED'::"OutboxStatus"
          AND (${eventType}::text IS NULL OR event."event_type" = ${eventType})
          AND (
            ${failureCode}::text IS NULL
            OR CASE
              WHEN event."last_error" ~ '^[A-Z][A-Z0-9_.-]{1,119}$' THEN event."last_error"
              ELSE 'OUTBOX_PUBLISH_FAILED'
            END = ${failureCode}
          )
        UNION ALL
        SELECT
          dead."id",
          dead."event_id" AS "eventId",
          'QUEUE'::text AS "source",
          dead."queue_name" AS "queueName",
          dead."event_type" AS "eventType",
          dead."attempt_count" AS "attemptCount",
          dead."failure_code" AS "failureCode",
          dead."status"::text AS "status",
          dead."last_failed_at" AS "failedAt"
        FROM "queue_dead_letters" dead
        WHERE ${includeQueue}
          AND dead."status" <> 'RESOLVED'::"QueueDeadLetterStatus"
          AND (${eventType}::text IS NULL OR dead."event_type" = ${eventType})
          AND (${failureCode}::text IS NULL OR dead."failure_code" = ${failureCode})
      )
      SELECT *
      FROM dead_letters
      WHERE (
        ${cursorDate}::timestamptz IS NULL
        OR "failedAt" < ${cursorDate}
        OR ("failedAt" = ${cursorDate} AND "id" < ${cursorId}::uuid)
      )
      ORDER BY "failedAt" DESC, "id" DESC
      LIMIT ${input.limit + 1}
    `);
    const hasMore = rows.length > input.limit;
    const items = rows.slice(0, input.limit);
    const last = hasMore ? items.at(-1) : undefined;
    return {
      items,
      nextCursor: last ? { failedAt: last.failedAt, id: last.id } : null,
    };
  }

  async createReplayJob(input: CreateQueueReplayJobInput): Promise<CreateQueueAdminJobResult> {
    assertBoundedInteger(input.targets.length, 100, "targets.length");
    return this.#transaction(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        input.actorUserId,
        AdminJobType.QUEUE_REPLAY,
        input.idempotencyKey,
      );
      const prior = await transaction.adminJob.findUnique({
        where: {
          actorId_type_idempotencyKey: {
            actorId: input.actorUserId,
            type: AdminJobType.QUEUE_REPLAY,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { ...jobProjectionSelect, requestHash: true },
      });
      if (prior) {
        return prior.requestHash === input.requestHash
          ? { kind: "exact_retry" as const, job: mapJob(prior) }
          : { kind: "idempotency_conflict" as const };
      }

      const outboxIds = input.targets
        .filter((target) => target.source === "OUTBOX")
        .map((target) => target.targetId);
      const queueIds = input.targets
        .filter((target) => target.source === "QUEUE")
        .map((target) => target.targetId);
      const [outboxCount, queueCount] = await Promise.all([
        transaction.outboxEvent.count({
          where: { id: { in: outboxIds }, status: OutboxStatus.FAILED },
        }),
        transaction.queueDeadLetter.count({
          where: {
            id: { in: queueIds },
            status: QueueDeadLetterStatus.OPEN,
          },
        }),
      ]);
      if (outboxCount !== outboxIds.length || queueCount !== queueIds.length) {
        return { kind: "invalid_targets" as const };
      }

      const jobId = randomUUID();
      const job = await transaction.adminJob.create({
        data: {
          id: jobId,
          type: AdminJobType.QUEUE_REPLAY,
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          reasonCode: input.reasonCode,
          ticketRef: input.ticketRef,
          estimatedItems: input.targets.length,
          availableAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: jobProjectionSelect,
      });
      await transaction.adminJobItem.createMany({
        data: input.targets.map((target) => ({
          id: randomUUID(),
          jobId,
          source: target.source as DeadLetterSource,
          targetId: target.targetId,
          createdAt: input.occurredAt,
        })),
      });
      if (queueIds.length > 0) {
        await transaction.queueDeadLetter.updateMany({
          where: { id: { in: queueIds }, status: QueueDeadLetterStatus.OPEN },
          data: { status: QueueDeadLetterStatus.REPLAY_PENDING, lastReplayBatchId: jobId },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "PLATFORM_ADMIN",
          action: "QUEUE_REPLAY_REQUESTED",
          targetType: "ADMIN_JOB",
          targetId: jobId,
          requestId: input.requestId,
          metadata: {
            reasonCode: input.reasonCode,
            ticketRef: input.ticketRef ?? null,
            targetCount: input.targets.length,
            sourceCounts: { OUTBOX: outboxIds.length, QUEUE: queueIds.length },
          },
          createdAt: input.occurredAt,
        },
      });
      return { kind: "created" as const, job: mapJob(job) };
    });
  }

  async createReconciliationJob(
    input: CreateQueueReconciliationJobInput,
  ): Promise<CreateQueueAdminJobResult> {
    assertBoundedInteger(input.maxItems, 500, "maxItems");
    return this.#transaction(async (transaction) => {
      await lockIdempotencyKey(
        transaction,
        input.actorUserId,
        AdminJobType.QUEUE_RECONCILIATION,
        input.idempotencyKey,
      );
      const prior = await transaction.adminJob.findUnique({
        where: {
          actorId_type_idempotencyKey: {
            actorId: input.actorUserId,
            type: AdminJobType.QUEUE_RECONCILIATION,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { ...jobProjectionSelect, requestHash: true },
      });
      if (prior) {
        return prior.requestHash === input.requestHash
          ? { kind: "exact_retry" as const, job: mapJob(prior) }
          : { kind: "idempotency_conflict" as const };
      }
      const jobId = randomUUID();
      const job = await transaction.adminJob.create({
        data: {
          id: jobId,
          type: AdminJobType.QUEUE_RECONCILIATION,
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          reasonCode: input.reasonCode,
          ticketRef: input.ticketRef,
          dryRun: input.dryRun,
          estimatedItems: input.maxItems,
          availableAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: jobProjectionSelect,
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "PLATFORM_ADMIN",
          action: "QUEUE_RECONCILIATION_REQUESTED",
          targetType: "ADMIN_JOB",
          targetId: jobId,
          requestId: input.requestId,
          metadata: {
            reasonCode: input.reasonCode,
            ticketRef: input.ticketRef ?? null,
            dryRun: input.dryRun,
            maximumItems: input.maxItems,
          },
          createdAt: input.occurredAt,
        },
      });
      return { kind: "created" as const, job: mapJob(job) };
    });
  }

  async getJob(jobId: string): Promise<QueueAdminJobProjection | null> {
    const job = await this.#client.adminJob.findUnique({
      where: { id: jobId },
      select: jobProjectionSelect,
    });
    return job ? mapJob(job) : null;
  }

  async claimJob(input: { now: Date; leaseSeconds: number }): Promise<ClaimedQueueAdminJob | null> {
    assertBoundedInteger(input.leaseSeconds, 3_600, "leaseSeconds");
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
    const rows = await this.#client.$queryRaw<
      Array<{
        id: string;
        type: AdminJobType;
        status: AdminJobStatus;
        actorUserId: string;
        reasonCode: string;
        ticketRef: string | null;
        dryRun: boolean;
        estimatedItems: number;
        processedItems: number;
        succeededItems: number;
        skippedItems: number;
        failedItems: number;
        createdAt: Date;
        startedAt: Date;
        completedAt: Date | null;
      }>
    >(Prisma.sql`
      WITH candidate AS (
        SELECT "id"
        FROM "admin_jobs"
        WHERE (
          ("status" = 'PENDING'::"AdminJobStatus" AND "available_at" <= ${input.now})
          OR ("status" = 'RUNNING'::"AdminJobStatus" AND "lease_expires_at" < ${input.now})
        )
        ORDER BY "available_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "admin_jobs" job
      SET
        "status" = 'RUNNING'::"AdminJobStatus",
        "started_at" = COALESCE(job."started_at", ${input.now}),
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${input.now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING
        job."id",
        job."type",
        job."status",
        job."actor_id" AS "actorUserId",
        job."reason_code" AS "reasonCode",
        job."ticket_ref" AS "ticketRef",
        job."dry_run" AS "dryRun",
        job."estimated_items" AS "estimatedItems",
        job."processed_items" AS "processedItems",
        job."succeeded_items" AS "succeededItems",
        job."skipped_items" AS "skippedItems",
        job."failed_items" AS "failedItems",
        job."created_at" AS "createdAt",
        job."started_at" AS "startedAt",
        job."completed_at" AS "completedAt"
    `);
    const row = rows[0];
    return row ? { ...mapJob(row), ...row, leaseExpiresAt } : null;
  }

  async listPendingJobItems(jobId: string, limit: number): Promise<QueueAdminJobItem[]> {
    assertBoundedInteger(limit, 500, "limit");
    const items = await this.#client.adminJobItem.findMany({
      where: { jobId, status: AdminJobItemStatus.PENDING },
      orderBy: { id: "asc" },
      take: limit,
    });
    return items.map((item) => ({
      id: item.id,
      jobId: item.jobId,
      source: item.source,
      targetId: item.targetId,
      status: item.status,
    }));
  }

  async completeJobItem(input: {
    itemId: string;
    status: "SUCCEEDED" | "SKIPPED" | "FAILED";
    errorCode?: string;
    completedAt: Date;
  }): Promise<boolean> {
    const result = await this.#client.adminJobItem.updateMany({
      where: { id: input.itemId, status: AdminJobItemStatus.PENDING },
      data: {
        status: input.status as AdminJobItemStatus,
        errorCode:
          input.status === "FAILED"
            ? boundedCode(input.errorCode ?? "QUEUE_OPERATION_FAILED", "QUEUE_OPERATION_FAILED")
            : null,
        completedAt: input.completedAt,
      },
    });
    return result.count === 1;
  }

  async countJobItemOutcomes(jobId: string): Promise<{
    succeededItems: number;
    skippedItems: number;
    failedItems: number;
  }> {
    const groups = await this.#client.adminJobItem.groupBy({
      by: ["status"],
      where: { jobId, status: { not: AdminJobItemStatus.PENDING } },
      _count: { _all: true },
    });
    const count = (status: AdminJobItemStatus): number =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      succeededItems: count(AdminJobItemStatus.SUCCEEDED),
      skippedItems: count(AdminJobItemStatus.SKIPPED),
      failedItems: count(AdminJobItemStatus.FAILED),
    };
  }

  async completeJob(input: {
    jobId: string;
    leaseExpiresAt: Date;
    succeededItems: number;
    skippedItems: number;
    failedItems: number;
    completedAt: Date;
  }): Promise<boolean> {
    const processedItems = input.succeededItems + input.skippedItems + input.failedItems;
    const status =
      input.failedItems === 0
        ? AdminJobStatus.SUCCEEDED
        : input.succeededItems + input.skippedItems > 0
          ? AdminJobStatus.PARTIAL
          : AdminJobStatus.FAILED;
    return this.#transaction(async (transaction) => {
      const result = await transaction.adminJob.updateMany({
        where: {
          id: input.jobId,
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        data: {
          status,
          processedItems,
          succeededItems: input.succeededItems,
          skippedItems: input.skippedItems,
          failedItems: input.failedItems,
          completedAt: input.completedAt,
          leaseExpiresAt: null,
          updatedAt: input.completedAt,
        },
      });
      if (result.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "QUEUE_ADMIN_JOB_COMPLETED",
          targetType: "ADMIN_JOB",
          targetId: input.jobId,
          metadata: { status, processedItems, failedItems: input.failedItems },
          createdAt: input.completedAt,
        },
      });
      return true;
    });
  }

  async resetFailedOutboxEvent(eventId: string, now: Date): Promise<"replayed" | "skipped"> {
    const result = await this.#client.outboxEvent.updateMany({
      where: { id: eventId, status: OutboxStatus.FAILED },
      data: {
        status: OutboxStatus.PENDING,
        attempts: 0,
        availableAt: now,
        publishedAt: null,
        lastError: null,
      },
    });
    return result.count === 1 ? "replayed" : "skipped";
  }

  async getQueueDeadLetter(id: string): Promise<QueueDeadLetterInternal | null> {
    const record = await this.#client.queueDeadLetter.findUnique({ where: { id } });
    return record
      ? {
          id: record.id,
          eventId: record.eventId,
          source: "QUEUE",
          queueName: record.queueName,
          eventType: record.eventType,
          attemptCount: record.attemptCount,
          failureCode: record.failureCode,
          status: record.status,
          failedAt: record.lastFailedAt,
          aggregateType: record.aggregateType,
          aggregateId: record.aggregateId,
          payloadHash: record.payloadHash,
        }
      : null;
  }

  async getCanonicalOutboxEvent(eventId: string): Promise<CanonicalOutboxEvent | null> {
    return this.#client.outboxEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        aggregateType: true,
        aggregateId: true,
        eventType: true,
        payload: true,
        createdAt: true,
      },
    });
  }

  async resolveQueueDeadLetter(input: {
    id: string;
    replayBatchId?: string;
    resolvedAt: Date;
  }): Promise<boolean> {
    const result = await this.#client.queueDeadLetter.updateMany({
      where: {
        id: input.id,
        status: { in: [QueueDeadLetterStatus.OPEN, QueueDeadLetterStatus.REPLAY_PENDING] },
      },
      data: {
        status: QueueDeadLetterStatus.RESOLVED,
        replayCount: { increment: input.replayBatchId ? 1 : 0 },
        lastReplayBatchId: input.replayBatchId,
        resolvedAt: input.resolvedAt,
      },
    });
    return result.count === 1;
  }

  async reopenQueueDeadLetter(id: string): Promise<void> {
    await this.#client.queueDeadLetter.updateMany({
      where: { id, status: QueueDeadLetterStatus.REPLAY_PENDING },
      data: { status: QueueDeadLetterStatus.OPEN, resolvedAt: null },
    });
  }

  async recordQueueDeadLetter(input: RecordQueueDeadLetterInput): Promise<void> {
    assertBoundedInteger(input.attemptCount, Number.MAX_SAFE_INTEGER, "attemptCount");
    await this.#client.queueDeadLetter.upsert({
      where: { queueName_eventId: { queueName: input.queueName, eventId: input.eventId } },
      create: {
        id: randomUUID(),
        eventId: input.eventId,
        queueName: input.queueName,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        attemptCount: input.attemptCount,
        failureCode: boundedCode(input.failureCode, "JOB_HANDLER_FAILED"),
        payloadHash: input.payloadHash,
        status: QueueDeadLetterStatus.OPEN,
        firstFailedAt: input.failedAt,
        lastFailedAt: input.failedAt,
        createdAt: input.failedAt,
        updatedAt: input.failedAt,
      },
      update: {
        attemptCount: input.attemptCount,
        failureCode: boundedCode(input.failureCode, "JOB_HANDLER_FAILED"),
        payloadHash: input.payloadHash,
        status: QueueDeadLetterStatus.OPEN,
        lastFailedAt: input.failedAt,
        resolvedAt: null,
        updatedAt: input.failedAt,
      },
    });
  }

  async listOpenQueueDeadLetters(limit: number): Promise<QueueDeadLetterInternal[]> {
    assertBoundedInteger(limit, 500, "limit");
    const records = await this.#client.queueDeadLetter.findMany({
      where: { status: { in: [QueueDeadLetterStatus.OPEN, QueueDeadLetterStatus.REPLAY_PENDING] } },
      orderBy: [{ lastFailedAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return records.map((record) => ({
      id: record.id,
      eventId: record.eventId,
      source: "QUEUE",
      queueName: record.queueName,
      eventType: record.eventType,
      attemptCount: record.attemptCount,
      failureCode: record.failureCode,
      status: record.status,
      failedAt: record.lastFailedAt,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      payloadHash: record.payloadHash,
    }));
  }

  async close(): Promise<void> {
    await (this.#ownedClient?.$disconnect() ?? Promise.resolve());
  }

  async #transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (this.#client instanceof PrismaClient) return this.#client.$transaction(operation);
    return operation(this.#client);
  }
}
