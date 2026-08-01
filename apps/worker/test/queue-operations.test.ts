import { UnrecoverableError, type Job } from "bullmq";
import type {
  ClaimedQueueAdminJob,
  QueueAdminJobItem,
  QueueDeadLetterInternal,
  RecordQueueDeadLetterInput,
} from "@socal/database/queue-operations";
import { createObservabilityRuntime } from "@socal/observability";
import { describe, expect, it, vi } from "vitest";
import {
  isTerminalJobFailure,
  queueFailurePayloadHash,
  recordTerminalJobFailure,
} from "../src/queue-operations/queue-failure-recorder";
import {
  QueueOperationsDispatcher,
  type QueueOperationsRepositoryPort,
} from "../src/queue-operations/queue-operations-dispatcher";

const eventId = "40000000-0000-4000-8000-000000000201";
const aggregateId = "40000000-0000-4000-8000-000000000202";
const deadLetterId = "40000000-0000-4000-8000-000000000203";
const adminJobId = "40000000-0000-4000-8000-000000000204";
const itemId = "40000000-0000-4000-8000-000000000205";

function envelope() {
  return {
    version: 1 as const,
    eventId,
    aggregateType: "Listing",
    aggregateId,
    eventType: "listing.published",
    occurredAt: "2026-08-01T08:00:00.000Z",
    payload: { listingId: aggregateId, privateEmail: "not-copied@example.invalid" },
  };
}

function asBullJob(overrides: Partial<Job> = {}): Job {
  return {
    id: eventId,
    name: "listing.published",
    data: envelope(),
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...overrides,
  } as unknown as Job;
}

function claimedJob(type: ClaimedQueueAdminJob["type"] = "QUEUE_REPLAY"): ClaimedQueueAdminJob {
  const now = new Date("2026-08-01T09:00:00.000Z");
  return {
    id: adminJobId,
    type,
    status: "RUNNING",
    actorUserId: "40000000-0000-4000-8000-000000000206",
    reasonCode: "INCIDENT_RECOVERY",
    ticketRef: "INC-42",
    dryRun: false,
    estimatedItems: 1,
    processedItems: 0,
    succeededItems: 0,
    skippedItems: 0,
    failedItems: 0,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    leaseExpiresAt: new Date("2026-08-01T09:01:00.000Z"),
  };
}

function queueDeadLetter(): QueueDeadLetterInternal {
  return {
    id: deadLetterId,
    eventId,
    source: "QUEUE",
    queueName: "socal-outbox",
    eventType: "listing.published",
    attemptCount: 3,
    failureCode: "JOB_HANDLER_FAILED",
    status: "REPLAY_PENDING",
    failedAt: new Date("2026-08-01T08:30:00.000Z"),
    aggregateType: "Listing",
    aggregateId,
    payloadHash: queueFailurePayloadHash(envelope().payload),
  };
}

class MemoryOperationsRepository implements QueueOperationsRepositoryPort {
  claim: ClaimedQueueAdminJob | null = claimedJob();
  items: QueueAdminJobItem[] = [
    { id: itemId, jobId: adminJobId, source: "QUEUE", targetId: deadLetterId, status: "PENDING" },
  ];
  deadLetter: QueueDeadLetterInternal | null = queueDeadLetter();
  recorded: RecordQueueDeadLetterInput[] = [];
  resolved: string[] = [];
  reopened: string[] = [];
  completedItems: Array<{ id: string; status: string }> = [];
  completedJobs: Array<{ succeeded: number; skipped: number; failed: number }> = [];
  outboxResetOutcome: "replayed" | "skipped" = "replayed";

  claimJob(): Promise<ClaimedQueueAdminJob | null> {
    const result = this.claim;
    this.claim = null;
    return Promise.resolve(result);
  }

  listPendingJobItems(): Promise<QueueAdminJobItem[]> {
    return Promise.resolve(this.items);
  }

  completeJobItem(input: {
    itemId: string;
    status: "SUCCEEDED" | "SKIPPED" | "FAILED";
  }): Promise<boolean> {
    this.completedItems.push({ id: input.itemId, status: input.status });
    return Promise.resolve(true);
  }

  completeJob(input: {
    succeededItems: number;
    skippedItems: number;
    failedItems: number;
  }): Promise<boolean> {
    this.completedJobs.push({
      succeeded: input.succeededItems,
      skipped: input.skippedItems,
      failed: input.failedItems,
    });
    return Promise.resolve(true);
  }

  countJobItemOutcomes(): Promise<{
    succeededItems: number;
    skippedItems: number;
    failedItems: number;
  }> {
    return Promise.resolve({
      succeededItems: this.completedItems.filter((item) => item.status === "SUCCEEDED").length,
      skippedItems: this.completedItems.filter((item) => item.status === "SKIPPED").length,
      failedItems: this.completedItems.filter((item) => item.status === "FAILED").length,
    });
  }

  resetFailedOutboxEvent(): Promise<"replayed" | "skipped"> {
    return Promise.resolve(this.outboxResetOutcome);
  }

  getQueueDeadLetter(): Promise<QueueDeadLetterInternal | null> {
    return Promise.resolve(this.deadLetter);
  }

  getCanonicalOutboxEvent() {
    return Promise.resolve({
      id: eventId,
      aggregateType: "Listing",
      aggregateId,
      eventType: "listing.published",
      payload: envelope().payload,
      createdAt: new Date(envelope().occurredAt),
    });
  }

  resolveQueueDeadLetter(input: { id: string }): Promise<boolean> {
    this.resolved.push(input.id);
    return Promise.resolve(true);
  }

  reopenQueueDeadLetter(id: string): Promise<void> {
    this.reopened.push(id);
    return Promise.resolve();
  }

  recordQueueDeadLetter(input: RecordQueueDeadLetterInput): Promise<void> {
    this.recorded.push(input);
    return Promise.resolve();
  }

  listOpenQueueDeadLetters(): Promise<QueueDeadLetterInternal[]> {
    return Promise.resolve(this.deadLetter ? [this.deadLetter] : []);
  }
}

function observability() {
  return createObservabilityRuntime({
    serviceName: "queue-operations-test",
    serviceVersion: "0.1.0",
    environment: "test",
    logSink: () => undefined,
  });
}

describe("queue terminal failure evidence", () => {
  it("hashes JSON payloads canonically across PostgreSQL JSONB key ordering", () => {
    expect(queueFailurePayloadHash({ nested: { z: 1, a: 2 }, version: 1 })).toBe(
      queueFailurePayloadHash({ version: 1, nested: { a: 2, z: 1 } }),
    );
  });

  it("records only a bounded code and hash after the final attempt", async () => {
    const recorded: RecordQueueDeadLetterInput[] = [];
    const repository = {
      recordQueueDeadLetter(input: RecordQueueDeadLetterInput): Promise<void> {
        recorded.push(input);
        return Promise.resolve();
      },
    };
    const job = asBullJob();
    expect(isTerminalJobFailure(job, new Error("provider leaked user email"))).toBe(true);
    expect(
      await recordTerminalJobFailure({
        repository,
        queueName: "socal-outbox",
        job,
        error: new Error("provider leaked user email"),
      }),
    ).toBe("recorded");
    expect(recorded[0]).toMatchObject({
      eventId,
      failureCode: "JOB_HANDLER_FAILED",
      attemptCount: 3,
    });
    expect(recorded[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(recorded[0])).not.toMatch(/privateEmail|not-copied|provider leaked/i);
  });

  it("does not create DLQ evidence while a retry remains and preserves safe permanent codes", async () => {
    const repository = { recordQueueDeadLetter: vi.fn(() => Promise.resolve()) };
    expect(
      await recordTerminalJobFailure({
        repository,
        queueName: "socal-outbox",
        job: asBullJob({ attemptsMade: 1 }),
        error: new Error("temporary"),
      }),
    ).toBe("retrying");
    expect(repository.recordQueueDeadLetter).not.toHaveBeenCalled();
    await recordTerminalJobFailure({
      repository,
      queueName: "socal-outbox",
      job: asBullJob({ attemptsMade: 1 }),
      error: new UnrecoverableError("MEDIA_MALWARE_DETECTED"),
    });
    expect(repository.recordQueueDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "MEDIA_MALWARE_DETECTED" }),
    );
    expect(
      await recordTerminalJobFailure({
        repository,
        queueName: "socal-outbox",
        job: asBullJob({ data: { ...envelope(), extraPrivateField: "must be rejected" } }),
        error: new Error("terminal"),
      }),
    ).toBe("invalid_envelope");
  });
});

describe("controlled queue operations dispatcher", () => {
  it("retries an existing failed BullMQ job and resolves durable evidence", async () => {
    const repository = new MemoryOperationsRepository();
    const retry = vi.fn(() => Promise.resolve());
    const dispatcher = new QueueOperationsDispatcher({
      repository,
      queue: {
        getJob: () =>
          Promise.resolve({
            id: eventId,
            name: "listing.published",
            data: envelope(),
            attemptsMade: 3,
            opts: { attempts: 3 },
            getState: () => Promise.resolve("failed"),
            retry,
          }),
        getJobs: () => Promise.resolve([]),
      },
      publisher: { publish: vi.fn(() => Promise.resolve()) },
      observability: observability(),
      pollIntervalMilliseconds: 1_000,
      leaseSeconds: 60,
    });
    expect(await dispatcher.dispatchOnce(new Date("2026-08-01T09:00:30.000Z"))).toEqual({
      claimed: 1,
      succeeded: 1,
      skipped: 0,
      failed: 0,
      stale: 0,
    });
    expect(retry).toHaveBeenCalledOnce();
    expect(repository.resolved).toEqual([deadLetterId]);
    expect(repository.completedItems).toEqual([{ id: itemId, status: "SUCCEEDED" }]);
    expect(repository.completedJobs).toEqual([{ succeeded: 1, skipped: 0, failed: 0 }]);
  });

  it("rebuilds a missing queue job from canonical Outbox data with the same event ID", async () => {
    const repository = new MemoryOperationsRepository();
    const publish = vi.fn(() => Promise.resolve());
    const dispatcher = new QueueOperationsDispatcher({
      repository,
      queue: { getJob: () => Promise.resolve(undefined), getJobs: () => Promise.resolve([]) },
      publisher: { publish },
      observability: observability(),
      pollIntervalMilliseconds: 1_000,
      leaseSeconds: 60,
    });
    const result = await dispatcher.dispatchOnce();
    expect(result.succeeded).toBe(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: eventId, attempt: 1 }));
    expect(repository.resolved).toEqual([deadLetterId]);
  });

  it("refuses to replay queue evidence that no longer matches canonical PostgreSQL data", async () => {
    const repository = new MemoryOperationsRepository();
    repository.deadLetter = { ...queueDeadLetter(), payloadHash: "0".repeat(64) };
    const retry = vi.fn(() => Promise.resolve());
    const dispatcher = new QueueOperationsDispatcher({
      repository,
      queue: {
        getJob: () =>
          Promise.resolve({
            id: eventId,
            name: "listing.published",
            data: envelope(),
            attemptsMade: 3,
            opts: { attempts: 3 },
            getState: () => Promise.resolve("failed"),
            retry,
          }),
        getJobs: () => Promise.resolve([]),
      },
      publisher: { publish: vi.fn(() => Promise.resolve()) },
      observability: observability(),
      pollIntervalMilliseconds: 1_000,
      leaseSeconds: 60,
    });

    expect(await dispatcher.dispatchOnce()).toMatchObject({ failed: 1, succeeded: 0 });
    expect(retry).not.toHaveBeenCalled();
    expect(repository.resolved).toHaveLength(0);
    expect(repository.reopened).toEqual([deadLetterId]);
  });

  it("resets failed Outbox records without writing directly to BullMQ", async () => {
    const repository = new MemoryOperationsRepository();
    repository.items = [
      { id: itemId, jobId: adminJobId, source: "OUTBOX", targetId: eventId, status: "PENDING" },
    ];
    const getJob = vi.fn(() => Promise.resolve(undefined));
    const publish = vi.fn(() => Promise.resolve());
    const dispatcher = new QueueOperationsDispatcher({
      repository,
      queue: { getJob, getJobs: () => Promise.resolve([]) },
      publisher: { publish },
      observability: observability(),
      pollIntervalMilliseconds: 1_000,
      leaseSeconds: 60,
    });
    expect((await dispatcher.dispatchOnce()).succeeded).toBe(1);
    expect(getJob).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("supports non-mutating reconciliation and rejects invalid failed envelopes", async () => {
    const repository = new MemoryOperationsRepository();
    repository.claim = { ...claimedJob("QUEUE_RECONCILIATION"), dryRun: true };
    repository.items = [];
    const dispatcher = new QueueOperationsDispatcher({
      repository,
      queue: {
        getJob: () => Promise.resolve(undefined),
        getJobs: () =>
          Promise.resolve([
            {
              id: "invalid",
              name: "listing.published",
              data: { payload: "invalid" },
              attemptsMade: 1,
              opts: { attempts: 1 },
              getState: () => Promise.resolve("failed"),
              retry: () => Promise.resolve(),
            },
          ]),
      },
      publisher: { publish: vi.fn(() => Promise.resolve()) },
      observability: observability(),
      pollIntervalMilliseconds: 1_000,
      leaseSeconds: 60,
    });
    const result = await dispatcher.dispatchOnce();
    expect(result).toMatchObject({ claimed: 1, succeeded: 0, failed: 1 });
    expect(repository.recorded).toHaveLength(0);
    expect(repository.resolved).toHaveLength(0);
  });
});
