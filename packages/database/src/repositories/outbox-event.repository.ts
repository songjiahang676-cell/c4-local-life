import { PrismaPg } from "@prisma/adapter-pg";
import { OutboxStatus, Prisma, PrismaClient } from "../../generated/prisma/client";

const outboxEventTypePattern = /^[a-z][a-z0-9.-]{0,79}$/;

export type OutboxEventRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type AppendOutboxEventInput = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
  createdAt?: Date;
};

export type ClaimedOutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempt: number;
  leaseExpiresAt: Date;
  createdAt: Date;
};

export type ClaimOutboxEventsInput = {
  now: Date;
  batchSize: number;
  leaseSeconds: number;
  priorityEventTypes?: readonly string[];
};

export type CompleteOutboxEventInput = {
  id: string;
  attempt: number;
  publishedAt: Date;
};

export type FailOutboxEventInput = {
  id: string;
  attempt: number;
  now: Date;
  retryAt: Date;
  errorCode: string;
  maximumAttempts: number;
  terminal?: boolean;
};

type OutboxClient = PrismaClient | Prisma.TransactionClient;

type ClaimedOutboxEventRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  attempt: number;
  createdAt: Date;
};

function isRepositoryOptions(
  target: OutboxClient | OutboxEventRepositoryOptions,
): target is OutboxEventRepositoryOptions {
  return "connectionString" in target;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function boundedErrorCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_.-]/g, "_")
    .slice(0, 120);
  return normalized || "OUTBOX_PUBLISH_FAILED";
}

export class OutboxEventRepository {
  readonly #client: OutboxClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: OutboxClient | OutboxEventRepositoryOptions) {
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

  async append(input: AppendOutboxEventInput): Promise<void> {
    if (!outboxEventTypePattern.test(input.eventType)) {
      throw new RangeError("Outbox event type must be a bounded lowercase dotted name");
    }
    await this.#client.outboxEvent.create({
      data: {
        id: input.id,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload,
        availableAt: input.availableAt,
        createdAt: input.createdAt,
      },
    });
  }

  async claimBatch(input: ClaimOutboxEventsInput): Promise<ClaimedOutboxEvent[]> {
    assertPositiveInteger(input.batchSize, "batchSize");
    assertPositiveInteger(input.leaseSeconds, "leaseSeconds");
    if (
      (input.priorityEventTypes?.length ?? 0) > 32 ||
      input.priorityEventTypes?.some((value) => !outboxEventTypePattern.test(value))
    ) {
      throw new RangeError("priorityEventTypes must contain at most 32 valid event types");
    }
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
    const priorityOrder =
      input.priorityEventTypes && input.priorityEventTypes.length > 0
        ? Prisma.sql`CASE WHEN "event_type" IN (${Prisma.join(
            input.priorityEventTypes,
          )}) THEN 0 ELSE 1 END`
        : Prisma.sql`0`;
    const rows = await this.#client.$queryRaw<ClaimedOutboxEventRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "outbox_events"
        WHERE "status" = 'PENDING'::"OutboxStatus"
          AND "available_at" <= ${input.now}
        ORDER BY ${priorityOrder} ASC, "available_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.batchSize}
      )
      UPDATE "outbox_events" AS event
      SET
        "attempts" = event."attempts" + 1,
        "available_at" = ${leaseExpiresAt},
        "last_error" = NULL
      FROM candidates
      WHERE event."id" = candidates."id"
      RETURNING
        event."id",
        event."aggregate_type" AS "aggregateType",
        event."aggregate_id" AS "aggregateId",
        event."event_type" AS "eventType",
        event."payload",
        event."attempts" AS "attempt",
        event."created_at" AS "createdAt"
    `);
    return rows.map((row) => ({ ...row, leaseExpiresAt }));
  }

  async markPublished(input: CompleteOutboxEventInput): Promise<boolean> {
    assertPositiveInteger(input.attempt, "attempt");
    const result = await this.#client.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: OutboxStatus.PENDING,
        attempts: input.attempt,
      },
      data: {
        status: OutboxStatus.PUBLISHED,
        publishedAt: input.publishedAt,
        availableAt: input.publishedAt,
        lastError: null,
      },
    });
    return result.count === 1;
  }

  async markFailed(input: FailOutboxEventInput): Promise<"retry" | "failed" | "stale"> {
    assertPositiveInteger(input.attempt, "attempt");
    assertPositiveInteger(input.maximumAttempts, "maximumAttempts");
    const exhausted = Boolean(input.terminal) || input.attempt >= input.maximumAttempts;
    const result = await this.#client.outboxEvent.updateMany({
      where: {
        id: input.id,
        status: OutboxStatus.PENDING,
        attempts: input.attempt,
      },
      data: {
        status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        availableAt: exhausted ? input.now : input.retryAt,
        publishedAt: null,
        lastError: boundedErrorCode(input.errorCode),
      },
    });
    if (result.count !== 1) return "stale";
    return exhausted ? "failed" : "retry";
  }

  async oldestPendingAgeSeconds(now: Date): Promise<number> {
    const result = await this.#client.outboxEvent.aggregate({
      where: { status: OutboxStatus.PENDING },
      _min: { createdAt: true },
    });
    if (!result._min.createdAt) return 0;
    return Math.max(0, (now.getTime() - result._min.createdAt.getTime()) / 1_000);
  }

  async close(): Promise<void> {
    await (this.#ownedClient?.$disconnect() ?? Promise.resolve());
  }
}
