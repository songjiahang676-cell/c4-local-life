import { createHash } from "node:crypto";
import type { ClaimedOutboxEvent, OutboxEventRepository } from "@socal/database/outbox";
import type { ObservabilityRuntime } from "@socal/observability";

export type OutboxPublisher = {
  publish(event: ClaimedOutboxEvent): Promise<void>;
};

export type OutboxRepository = Pick<
  OutboxEventRepository,
  "claimBatch" | "markPublished" | "markFailed" | "oldestPendingAgeSeconds"
>;

export class PermanentOutboxPublishError extends Error {
  readonly code = "OUTBOX_EVENT_INVALID";

  constructor() {
    super("The outbox event cannot be published");
    this.name = "PermanentOutboxPublishError";
  }
}

export type OutboxDispatcherConfiguration = {
  batchSize: number;
  leaseSeconds: number;
  maximumAttempts: number;
  retryBaseSeconds: number;
  retryMaximumSeconds: number;
  pollIntervalMilliseconds: number;
  priorityEventTypes?: readonly string[];
};

export type OutboxDispatchSummary = {
  claimed: number;
  published: number;
  retry: number;
  failed: number;
  stale: number;
  oldestPendingAgeSeconds: number;
};

function retryDelaySeconds(
  eventId: string,
  attempt: number,
  baseSeconds: number,
  maximumSeconds: number,
): number {
  const exponent = Math.min(20, Math.max(0, attempt - 1));
  const unjittered = Math.min(maximumSeconds, baseSeconds * 2 ** exponent);
  const digest = createHash("sha256").update(`${eventId}\0${attempt}`, "utf8").digest();
  const multiplier = 0.75 + (digest[0] ?? 0) / 510;
  return Math.max(1, Math.min(maximumSeconds, Math.round(unjittered * multiplier)));
}

function errorCode(error: unknown): string {
  if (error instanceof PermanentOutboxPublishError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_.-]{2,119}$/.test(error.name)) return error.name;
  return "OUTBOX_PUBLISH_FAILED";
}

export class OutboxDispatcher {
  readonly #repository: OutboxRepository;
  readonly #publisher: OutboxPublisher;
  readonly #observability: ObservabilityRuntime;
  readonly #configuration: OutboxDispatcherConfiguration;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> | null = null;
  #stopping = false;

  constructor(input: {
    repository: OutboxRepository;
    publisher: OutboxPublisher;
    observability: ObservabilityRuntime;
    configuration: OutboxDispatcherConfiguration;
  }) {
    this.#repository = input.repository;
    this.#publisher = input.publisher;
    this.#observability = input.observability;
    this.#configuration = input.configuration;
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

  async dispatchOnce(now = new Date()): Promise<OutboxDispatchSummary> {
    const claims = await this.#repository.claimBatch({
      now,
      batchSize: this.#configuration.batchSize,
      leaseSeconds: this.#configuration.leaseSeconds,
      ...(this.#configuration.priorityEventTypes
        ? { priorityEventTypes: this.#configuration.priorityEventTypes }
        : {}),
    });
    const summary: OutboxDispatchSummary = {
      claimed: claims.length,
      published: 0,
      retry: 0,
      failed: 0,
      stale: 0,
      oldestPendingAgeSeconds: 0,
    };

    for (const event of claims) {
      try {
        await this.#publisher.publish(event);
        const updated = await this.#repository.markPublished({
          id: event.id,
          attempt: event.attempt,
          publishedAt: now,
        });
        const outcome = updated ? "published" : "stale";
        summary[outcome] += 1;
        this.#observability.metrics.outboxDispatch(outcome);
      } catch (error: unknown) {
        const terminal = error instanceof PermanentOutboxPublishError;
        const delaySeconds = retryDelaySeconds(
          event.id,
          event.attempt,
          this.#configuration.retryBaseSeconds,
          this.#configuration.retryMaximumSeconds,
        );
        const outcome = await this.#repository.markFailed({
          id: event.id,
          attempt: event.attempt,
          now,
          retryAt: new Date(now.getTime() + delaySeconds * 1_000),
          errorCode: errorCode(error),
          maximumAttempts: this.#configuration.maximumAttempts,
          terminal,
        });
        summary[outcome] += 1;
        this.#observability.metrics.outboxDispatch(outcome);
        this.#observability.logger.warn("worker.outbox.publish_failed", {
          eventId: event.id,
          attempt: event.attempt,
          outcome,
          errorCode: errorCode(error),
        });
      }
    }

    summary.oldestPendingAgeSeconds = await this.#repository.oldestPendingAgeSeconds(now);
    this.#observability.metrics.setOutboxOldestPendingAgeSeconds(summary.oldestPendingAgeSeconds);
    this.#observability.logger.info("worker.outbox.poll_completed", summary);
    return summary;
  }

  #schedule(delayMilliseconds: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#observability.metrics.outboxPollFailed();
          this.#observability.logger.error("worker.outbox.poll_failed", {
            errorCode: "OUTBOX_POLL_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.#inFlight = null;
          this.#schedule(this.#configuration.pollIntervalMilliseconds);
        });
    }, delayMilliseconds);
    this.#timer.unref();
  }
}
