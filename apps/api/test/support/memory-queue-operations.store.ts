import type {
  CreateQueueAdminJobResult,
  CreateQueueReconciliationJobInput,
  CreateQueueReplayJobInput,
  ListQueueDeadLettersInput,
  ListQueueDeadLettersResult,
  QueueAdminJobProjection,
} from "../../src/modules/admin/queue-operations.store";
import type { QueueOperationsStore } from "../../src/modules/admin/queue-operations.store";

export const memoryOutboxFailureId = "40000000-0000-4000-8000-000000000101";
export const memoryQueueDeadLetterId = "40000000-0000-4000-8000-000000000102";
export const memoryQueueEventId = "40000000-0000-4000-8000-000000000103";

export class MemoryQueueOperationsStore implements QueueOperationsStore {
  readonly replayInputs: CreateQueueReplayJobInput[] = [];
  readonly reconciliationInputs: CreateQueueReconciliationJobInput[] = [];
  readonly #jobs = new Map<string, QueueAdminJobProjection>();
  readonly #idempotency = new Map<string, { requestHash: string; jobId: string }>();

  listDeadLetters(input: ListQueueDeadLettersInput): Promise<ListQueueDeadLettersResult> {
    const records: ListQueueDeadLettersResult["items"] = [
      {
        id: memoryOutboxFailureId,
        eventId: memoryOutboxFailureId,
        source: "OUTBOX",
        queueName: "socal-outbox",
        eventType: "listing.published",
        attemptCount: 5,
        failureCode: "OUTBOX_PUBLISH_FAILED",
        status: "OPEN",
        failedAt: new Date("2026-08-01T08:00:00.000Z"),
      },
      {
        id: memoryQueueDeadLetterId,
        eventId: memoryQueueEventId,
        source: "QUEUE",
        queueName: "socal-outbox",
        eventType: "media.upload.completed",
        attemptCount: 3,
        failureCode: "JOB_HANDLER_FAILED",
        status: "OPEN",
        failedAt: new Date("2026-08-01T07:00:00.000Z"),
      },
    ];
    return Promise.resolve({
      items: records
        .filter((record) => !input.source || record.source === input.source)
        .filter((record) => !input.eventType || record.eventType === input.eventType)
        .filter((record) => !input.failureCode || record.failureCode === input.failureCode)
        .slice(0, input.limit),
      nextCursor: null,
    });
  }

  createReplayJob(input: CreateQueueReplayJobInput): Promise<CreateQueueAdminJobResult> {
    this.replayInputs.push(input);
    const targetIds = new Set([memoryOutboxFailureId, memoryQueueDeadLetterId]);
    if (input.targets.some((target) => !targetIds.has(target.targetId))) {
      return Promise.resolve({ kind: "invalid_targets" });
    }
    return Promise.resolve(this.#createJob("QUEUE_REPLAY", input));
  }

  createReconciliationJob(
    input: CreateQueueReconciliationJobInput,
  ): Promise<CreateQueueAdminJobResult> {
    this.reconciliationInputs.push(input);
    return Promise.resolve(this.#createJob("QUEUE_RECONCILIATION", input));
  }

  getJob(jobId: string): Promise<QueueAdminJobProjection | null> {
    return Promise.resolve(this.#jobs.get(jobId) ?? null);
  }

  #createJob(
    type: QueueAdminJobProjection["type"],
    input: CreateQueueReplayJobInput | CreateQueueReconciliationJobInput,
  ): CreateQueueAdminJobResult {
    const key = `${input.actorUserId}:${type}:${input.idempotencyKey}`;
    const prior = this.#idempotency.get(key);
    if (prior) {
      return prior.requestHash === input.requestHash
        ? { kind: "exact_retry", job: this.#jobs.get(prior.jobId)! }
        : { kind: "idempotency_conflict" };
    }
    const jobId =
      type === "QUEUE_REPLAY"
        ? "40000000-0000-4000-8000-000000000104"
        : "40000000-0000-4000-8000-000000000105";
    const job: QueueAdminJobProjection = {
      id: jobId,
      type,
      status: "PENDING",
      dryRun: "dryRun" in input ? input.dryRun : false,
      estimatedItems: "targets" in input ? input.targets.length : input.maxItems,
      processedItems: 0,
      succeededItems: 0,
      skippedItems: 0,
      failedItems: 0,
      createdAt: input.occurredAt,
      startedAt: null,
      completedAt: null,
    };
    this.#jobs.set(jobId, job);
    this.#idempotency.set(key, { requestHash: input.requestHash, jobId });
    return { kind: "created", job };
  }
}
