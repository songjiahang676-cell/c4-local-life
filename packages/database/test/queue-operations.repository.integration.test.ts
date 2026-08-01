import { randomUUID } from "node:crypto";
import { AdminJobStatus, OutboxStatus, QueueDeadLetterStatus } from "../generated/prisma/client";
import { QueueOperationsRepository } from "../src/repositories/queue-operations.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("QueueOperationsRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("lists both DLQ sources without copying payload or aggregate data", async () => {
    const repository = new QueueOperationsRepository(database.client);
    const outboxId = randomUUID();
    const queueEventId = randomUUID();
    const aggregateId = randomUUID();
    const failedAt = new Date("2026-08-01T08:00:00.000Z");
    try {
      await database.client.outboxEvent.create({
        data: {
          id: outboxId,
          aggregateType: "LISTING",
          aggregateId,
          eventType: "listing.published",
          payload: { privateEmail: "never-returned@example.invalid" },
          status: OutboxStatus.FAILED,
          attempts: 5,
          availableAt: failedAt,
          lastError: "provider leaked never-returned@example.invalid",
          createdAt: new Date(failedAt.getTime() - 1_000),
        },
      });
      await repository.recordQueueDeadLetter({
        eventId: queueEventId,
        queueName: "socal-outbox",
        eventType: "listing.published",
        aggregateType: "LISTING",
        aggregateId,
        attemptCount: 3,
        failureCode: "handler leaked@example.invalid",
        payloadHash: "a".repeat(64),
        failedAt: new Date(failedAt.getTime() + 1_000),
      });
      const result = await repository.listDeadLetters({ limit: 20 });
      expect(result.items).toHaveLength(2);
      expect(result.items.map((item) => item.source).sort()).toEqual(["OUTBOX", "QUEUE"]);
      expect(result.items.find((item) => item.source === "QUEUE")?.failureCode).toBe(
        "JOB_HANDLER_FAILED",
      );
      expect(result.items.find((item) => item.source === "OUTBOX")?.failureCode).toBe(
        "OUTBOX_PUBLISH_FAILED",
      );
      expect(JSON.stringify(result)).not.toMatch(
        /privateEmail|never-returned|aggregateId|payloadHash/i,
      );
    } finally {
      await database.client.queueDeadLetter.deleteMany({ where: { eventId: queueEventId } });
      await database.client.outboxEvent.deleteMany({ where: { id: outboxId } });
    }
  });

  it("creates an actor-bound replay batch idempotently and preserves audit evidence", async () => {
    const repository = new QueueOperationsRepository(database.client);
    const actorId = randomUUID();
    const outboxId = randomUUID();
    const queueEventId = randomUUID();
    const aggregateId = randomUUID();
    const now = new Date("2026-08-01T09:00:00.000Z");
    let jobId: string | undefined;
    try {
      await database.client.user.create({
        data: { id: actorId, email: `${actorId}@example.invalid` },
      });
      await database.client.outboxEvent.create({
        data: {
          id: outboxId,
          aggregateType: "LISTING",
          aggregateId,
          eventType: "listing.published",
          payload: { schemaVersion: 1 },
          status: OutboxStatus.FAILED,
          attempts: 5,
          availableAt: now,
          lastError: "OUTBOX_PUBLISH_FAILED",
          createdAt: now,
        },
      });
      await repository.recordQueueDeadLetter({
        eventId: queueEventId,
        queueName: "socal-outbox",
        eventType: "listing.published",
        aggregateType: "LISTING",
        aggregateId,
        attemptCount: 3,
        failureCode: "JOB_HANDLER_FAILED",
        payloadHash: "b".repeat(64),
        failedAt: now,
      });
      const queueDeadLetter = await database.client.queueDeadLetter.findUniqueOrThrow({
        where: { queueName_eventId: { queueName: "socal-outbox", eventId: queueEventId } },
      });
      const input = {
        actorUserId: actorId,
        idempotencyKey: "queue-replay-integration-0001",
        requestHash: "c".repeat(64),
        requestId: "queue-request-1",
        reasonCode: "INCIDENT_RECOVERY",
        ticketRef: "INC-42",
        targets: [
          { source: "OUTBOX" as const, targetId: outboxId },
          { source: "QUEUE" as const, targetId: queueDeadLetter.id },
        ],
        occurredAt: now,
      };
      const concurrent = await Promise.all([
        repository.createReplayJob(input),
        repository.createReplayJob(input),
      ]);
      expect(concurrent.map((result) => result.kind).sort()).toEqual(["created", "exact_retry"]);
      const created = concurrent.find((result) => result.kind === "created")!;
      const retry = concurrent.find((result) => result.kind === "exact_retry")!;
      const conflict = await repository.createReplayJob({ ...input, requestHash: "d".repeat(64) });
      expect(created.kind).toBe("created");
      expect(retry.kind).toBe("exact_retry");
      expect(conflict).toEqual({ kind: "idempotency_conflict" });
      if (created.kind !== "created") throw new Error("Expected created replay job");
      jobId = created.job.id;
      await expect(
        repository.createReplayJob({
          ...input,
          idempotencyKey: "queue-replay-integration-busy-target",
          requestHash: "f".repeat(64),
          targets: [{ source: "QUEUE", targetId: queueDeadLetter.id }],
        }),
      ).resolves.toEqual({ kind: "invalid_targets" });
      expect(created.job.estimatedItems).toBe(2);
      await expect(
        database.client.adminJobItem.count({ where: { jobId: created.job.id } }),
      ).resolves.toBe(2);
      await expect(
        database.client.queueDeadLetter.findUniqueOrThrow({ where: { id: queueDeadLetter.id } }),
      ).resolves.toMatchObject({
        status: QueueDeadLetterStatus.REPLAY_PENDING,
        lastReplayBatchId: created.job.id,
      });
      await expect(
        database.client.auditLog.findFirst({
          where: { action: "QUEUE_REPLAY_REQUESTED", targetId: created.job.id },
        }),
      ).resolves.toMatchObject({ actorId, requestId: "queue-request-1" });
    } finally {
      if (jobId) {
        await database.client.auditLog.deleteMany({ where: { targetId: jobId } });
        await database.client.adminJobItem.deleteMany({ where: { jobId } });
        await database.client.adminJob.deleteMany({ where: { id: jobId } });
      }
      await database.client.queueDeadLetter.deleteMany({ where: { eventId: queueEventId } });
      await database.client.outboxEvent.deleteMany({ where: { id: outboxId } });
      await database.client.user.deleteMany({ where: { id: actorId } });
    }
  });

  it("leases Admin work, performs idempotent item outcomes, and rejects stale completion", async () => {
    const repository = new QueueOperationsRepository(database.client);
    const actorId = randomUUID();
    const outboxId = randomUUID();
    const now = new Date("2026-08-01T10:00:00.000Z");
    let jobId: string | undefined;
    try {
      await database.client.user.create({
        data: { id: actorId, email: `${actorId}@example.invalid` },
      });
      await database.client.outboxEvent.create({
        data: {
          id: outboxId,
          aggregateType: "LISTING",
          aggregateId: randomUUID(),
          eventType: "listing.published",
          payload: { schemaVersion: 1 },
          status: OutboxStatus.FAILED,
          attempts: 5,
          availableAt: now,
          lastError: "OUTBOX_PUBLISH_FAILED",
          createdAt: now,
        },
      });
      const created = await repository.createReplayJob({
        actorUserId: actorId,
        idempotencyKey: "queue-replay-integration-0002",
        requestHash: "e".repeat(64),
        requestId: "queue-request-2",
        reasonCode: "INCIDENT_RECOVERY",
        targets: [{ source: "OUTBOX", targetId: outboxId }],
        occurredAt: now,
      });
      if (created.kind !== "created") throw new Error("Expected created replay job");
      jobId = created.job.id;
      const claim = await repository.claimJob({ now, leaseSeconds: 60 });
      expect(claim).toMatchObject({ id: jobId, status: AdminJobStatus.RUNNING });
      if (!claim) throw new Error("Expected claimed replay job");
      const item = (await repository.listPendingJobItems(jobId, 10))[0]!;
      await expect(
        repository.completeJobItem({ itemId: item.id, status: "SUCCEEDED", completedAt: now }),
      ).resolves.toBe(true);
      await expect(
        repository.completeJobItem({ itemId: item.id, status: "SUCCEEDED", completedAt: now }),
      ).resolves.toBe(false);
      await expect(
        repository.completeJob({
          jobId,
          leaseExpiresAt: new Date(claim.leaseExpiresAt.getTime() + 1),
          succeededItems: 1,
          skippedItems: 0,
          failedItems: 0,
          completedAt: now,
        }),
      ).resolves.toBe(false);
      await expect(
        repository.completeJob({
          jobId,
          leaseExpiresAt: claim.leaseExpiresAt,
          succeededItems: 1,
          skippedItems: 0,
          failedItems: 0,
          completedAt: now,
        }),
      ).resolves.toBe(true);
      await expect(repository.resetFailedOutboxEvent(outboxId, now)).resolves.toBe("replayed");
      await expect(repository.resetFailedOutboxEvent(outboxId, now)).resolves.toBe("skipped");
    } finally {
      if (jobId) {
        await database.client.auditLog.deleteMany({ where: { targetId: jobId } });
        await database.client.adminJobItem.deleteMany({ where: { jobId } });
        await database.client.adminJob.deleteMany({ where: { id: jobId } });
      }
      await database.client.outboxEvent.deleteMany({ where: { id: outboxId } });
      await database.client.user.deleteMany({ where: { id: actorId } });
    }
  });
});
