import type { JobsOptions } from "bullmq";
import type {
  ClaimedQueueAdminJob,
  QueueAdminJobItem,
  QueueDeadLetterInternal,
  QueueOperationsRepository,
} from "@socal/database/queue-operations";
import type { ClaimedOutboxEvent } from "@socal/database/outbox";
import type { ObservabilityRuntime } from "@socal/observability";
import type { OutboxPublisher } from "../outbox/outbox-dispatcher";
import { parseOutboxEnvelope, queueFailurePayloadHash } from "./queue-failure-recorder";

type QueueJob = {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  opts: JobsOptions;
  getState(): Promise<string>;
  retry(): Promise<void>;
};

type QueueControl = {
  getJob(id: string): Promise<QueueJob | undefined>;
  getJobs(types: readonly string[], start: number, end: number, asc?: boolean): Promise<QueueJob[]>;
};

export type QueueOperationsRepositoryPort = Pick<
  QueueOperationsRepository,
  | "claimJob"
  | "listPendingJobItems"
  | "completeJobItem"
  | "countJobItemOutcomes"
  | "completeJob"
  | "resetFailedOutboxEvent"
  | "getQueueDeadLetter"
  | "getCanonicalOutboxEvent"
  | "resolveQueueDeadLetter"
  | "reopenQueueDeadLetter"
  | "recordQueueDeadLetter"
  | "listOpenQueueDeadLetters"
>;

export type QueueOperationsSummary = {
  claimed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  stale: number;
};

function canonicalClaim(
  event: Awaited<ReturnType<QueueOperationsRepositoryPort["getCanonicalOutboxEvent"]>>,
): ClaimedOutboxEvent | null {
  if (!event) return null;
  return {
    ...event,
    attempt: 1,
    leaseExpiresAt: new Date(0),
  };
}

export class QueueOperationsDispatcher {
  readonly #repository: QueueOperationsRepositoryPort;
  readonly #queue: QueueControl;
  readonly #publisher: OutboxPublisher;
  readonly #observability: ObservabilityRuntime;
  readonly #pollIntervalMilliseconds: number;
  readonly #leaseSeconds: number;
  readonly #queueName: string;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> | null = null;
  #stopping = false;

  constructor(input: {
    repository: QueueOperationsRepositoryPort;
    queue: QueueControl;
    publisher: OutboxPublisher;
    observability: ObservabilityRuntime;
    pollIntervalMilliseconds: number;
    leaseSeconds: number;
    queueName?: string;
  }) {
    this.#repository = input.repository;
    this.#queue = input.queue;
    this.#publisher = input.publisher;
    this.#observability = input.observability;
    this.#pollIntervalMilliseconds = input.pollIntervalMilliseconds;
    this.#leaseSeconds = input.leaseSeconds;
    this.#queueName = input.queueName ?? "socal-outbox";
  }

  start(): void {
    if (this.#timer || this.#inFlight) return;
    this.#stopping = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await (this.#inFlight ?? Promise.resolve());
  }

  async dispatchOnce(now = new Date()): Promise<QueueOperationsSummary> {
    const job = await this.#repository.claimJob({ now, leaseSeconds: this.#leaseSeconds });
    if (!job) return { claimed: 0, succeeded: 0, skipped: 0, failed: 0, stale: 0 };
    let result =
      job.type === "QUEUE_REPLAY"
        ? await this.#processReplay(job, now)
        : await this.#processReconciliation(job, now);
    if (job.type === "QUEUE_REPLAY") {
      const itemCounts = await this.#repository.countJobItemOutcomes(job.id);
      result = {
        succeeded: itemCounts.succeededItems,
        skipped: itemCounts.skippedItems,
        failed: itemCounts.failedItems,
      };
    }
    const completed = await this.#repository.completeJob({
      jobId: job.id,
      leaseExpiresAt: job.leaseExpiresAt,
      succeededItems: result.succeeded,
      skippedItems: result.skipped,
      failedItems: result.failed,
      completedAt: now,
    });
    const summary = { claimed: 1, ...result, stale: completed ? 0 : 1 };
    this.#observability.metrics.queueAdminOperation(job.type, completed ? "completed" : "stale");
    this.#observability.logger.info("worker.queue_admin_job.completed", {
      jobId: job.id,
      jobType: job.type,
      ...summary,
    });
    return summary;
  }

  async #processReplay(
    job: ClaimedQueueAdminJob,
    now: Date,
  ): Promise<Pick<QueueOperationsSummary, "succeeded" | "skipped" | "failed">> {
    const items = await this.#repository.listPendingJobItems(job.id, job.estimatedItems);
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    for (const item of items) {
      const outcome = await this.#replayItem(job, item, now).catch(async () => {
        if (item.source === "QUEUE") await this.#repository.reopenQueueDeadLetter(item.targetId);
        return { status: "FAILED" as const, errorCode: "QUEUE_REPLAY_FAILED" };
      });
      const updated = await this.#repository.completeJobItem({
        itemId: item.id,
        status: outcome.status,
        ...(outcome.status === "FAILED" ? { errorCode: outcome.errorCode } : {}),
        completedAt: now,
      });
      if (outcome.status === "FAILED" && item.source === "QUEUE") {
        await this.#repository.reopenQueueDeadLetter(item.targetId);
      }
      if (!updated) continue;
      if (outcome.status === "SUCCEEDED") succeeded += 1;
      else if (outcome.status === "SKIPPED") skipped += 1;
      else failed += 1;
      this.#observability.metrics.queueAdminOperation(
        "QUEUE_REPLAY",
        outcome.status.toLowerCase() as "succeeded" | "skipped" | "failed",
      );
    }
    return { succeeded, skipped, failed };
  }

  async #replayItem(
    batch: ClaimedQueueAdminJob,
    item: QueueAdminJobItem,
    now: Date,
  ): Promise<{ status: "SUCCEEDED" | "SKIPPED" } | { status: "FAILED"; errorCode: string }> {
    if (item.source === "OUTBOX") {
      const outcome = await this.#repository.resetFailedOutboxEvent(item.targetId, now);
      return { status: outcome === "replayed" ? "SUCCEEDED" : "SKIPPED" };
    }

    const deadLetter = await this.#repository.getQueueDeadLetter(item.targetId);
    if (!deadLetter) return { status: "SKIPPED" };
    const canonical = canonicalClaim(
      await this.#repository.getCanonicalOutboxEvent(deadLetter.eventId),
    );
    if (!canonical) return { status: "FAILED", errorCode: "CANONICAL_EVENT_MISSING" };
    if (
      canonical.eventType !== deadLetter.eventType ||
      canonical.aggregateType !== deadLetter.aggregateType ||
      canonical.aggregateId !== deadLetter.aggregateId ||
      queueFailurePayloadHash(canonical.payload) !== deadLetter.payloadHash
    ) {
      return { status: "FAILED", errorCode: "CANONICAL_EVENT_MISMATCH" };
    }
    const queueJob = await this.#queue.getJob(deadLetter.eventId);
    if (queueJob) {
      const queued = parseOutboxEnvelope(queueJob.data);
      if (
        !queued ||
        queueJob.name !== deadLetter.eventType ||
        queued.eventId !== deadLetter.eventId ||
        queued.eventType !== deadLetter.eventType ||
        queued.aggregateType !== deadLetter.aggregateType ||
        queued.aggregateId !== deadLetter.aggregateId ||
        new Date(queued.occurredAt).getTime() !== canonical.createdAt.getTime() ||
        queueFailurePayloadHash(queued.payload) !== deadLetter.payloadHash
      ) {
        return { status: "FAILED", errorCode: "QUEUE_EVENT_MISMATCH" };
      }
      const state = await queueJob.getState();
      if (state === "failed") await queueJob.retry();
      else {
        await this.#repository.resolveQueueDeadLetter({
          id: deadLetter.id,
          replayBatchId: batch.id,
          resolvedAt: now,
        });
        return { status: "SKIPPED" };
      }
    } else {
      await this.#publisher.publish(canonical);
    }
    await this.#repository.resolveQueueDeadLetter({
      id: deadLetter.id,
      replayBatchId: batch.id,
      resolvedAt: now,
    });
    return { status: "SUCCEEDED" };
  }

  async #processReconciliation(
    job: ClaimedQueueAdminJob,
    now: Date,
  ): Promise<Pick<QueueOperationsSummary, "succeeded" | "skipped" | "failed">> {
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const observedEventIds = new Set<string>();
    const failedJobs = await this.#queue.getJobs(["failed"], 0, job.estimatedItems - 1, true);
    for (const failedJob of failedJobs) {
      const envelope = parseOutboxEnvelope(failedJob.data);
      if (!envelope || envelope.eventType !== failedJob.name) {
        failed += 1;
        continue;
      }
      observedEventIds.add(envelope.eventId);
      if (!job.dryRun) {
        await this.#repository.recordQueueDeadLetter({
          eventId: envelope.eventId,
          queueName: this.#queueName,
          eventType: envelope.eventType,
          aggregateType: envelope.aggregateType,
          aggregateId: envelope.aggregateId,
          attemptCount: Math.max(1, failedJob.attemptsMade),
          failureCode: "JOB_HANDLER_FAILED",
          payloadHash: queueFailurePayloadHash(envelope.payload),
          failedAt: now,
        });
      }
      succeeded += 1;
    }

    const remaining = Math.max(0, job.estimatedItems - succeeded - failed);
    if (remaining > 0) {
      const evidence = await this.#repository.listOpenQueueDeadLetters(remaining);
      for (const deadLetter of evidence) {
        if (observedEventIds.has(deadLetter.eventId)) continue;
        const outcome = await this.#reconcileEvidence(job, deadLetter, now).catch(
          () => "failed" as const,
        );
        if (outcome === "succeeded") succeeded += 1;
        else if (outcome === "skipped") skipped += 1;
        else failed += 1;
        if (succeeded + skipped + failed >= job.estimatedItems) break;
      }
    }
    this.#observability.metrics.queueAdminOperation(
      "QUEUE_RECONCILIATION",
      failed > 0 ? "failed" : "succeeded",
    );
    return { succeeded, skipped, failed };
  }

  async #reconcileEvidence(
    job: ClaimedQueueAdminJob,
    deadLetter: QueueDeadLetterInternal,
    now: Date,
  ): Promise<"succeeded" | "skipped"> {
    const queueJob = await this.#queue.getJob(deadLetter.eventId);
    if (deadLetter.queueName !== this.#queueName) return "skipped";
    if (!queueJob) return "skipped";
    const state = await queueJob.getState();
    if (state === "failed") return "skipped";
    if (!job.dryRun) {
      await this.#repository.resolveQueueDeadLetter({ id: deadLetter.id, resolvedAt: now });
    }
    return "succeeded";
  }

  #schedule(delayMilliseconds: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#observability.metrics.queueAdminOperation("CONTROL_PLANE", "poll_failed");
          this.#observability.logger.error("worker.queue_admin_job.poll_failed", {
            errorCode: "QUEUE_ADMIN_JOB_POLL_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.#inFlight = null;
          this.#schedule(this.#pollIntervalMilliseconds);
        });
    }, delayMilliseconds);
    this.#timer.unref();
  }
}
