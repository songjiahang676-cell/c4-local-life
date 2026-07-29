import type { JobsOptions } from "bullmq";
import type { ClaimedOutboxEvent } from "@socal/database/outbox";
import { PermanentOutboxPublishError, type OutboxPublisher } from "./outbox-dispatcher";

const eventTypePattern = /^[a-z][a-z0-9.-]{0,79}$/;

export type OutboxJobEnvelope = {
  version: 1;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  payload: ClaimedOutboxEvent["payload"];
};

type QueueProducer = {
  add(name: string, data: OutboxJobEnvelope, options: JobsOptions): Promise<unknown>;
};

export class BullMqOutboxPublisher implements OutboxPublisher {
  readonly #queue: QueueProducer;
  readonly #maximumPayloadBytes: number;
  readonly #jobOptions: JobsOptions;
  readonly #priorityEventTypes: ReadonlySet<string>;

  constructor(
    queue: QueueProducer,
    options: {
      maximumPayloadBytes: number;
      jobAttempts: number;
      priorityEventTypes?: readonly string[];
    },
  ) {
    this.#queue = queue;
    this.#maximumPayloadBytes = options.maximumPayloadBytes;
    this.#priorityEventTypes = new Set(options.priorityEventTypes ?? []);
    this.#jobOptions = {
      attempts: options.jobAttempts,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100_000 },
      removeOnFail: { age: 30 * 24 * 60 * 60, count: 100_000 },
    };
  }

  async publish(event: ClaimedOutboxEvent): Promise<void> {
    if (!eventTypePattern.test(event.eventType)) throw new PermanentOutboxPublishError();
    const envelope: OutboxJobEnvelope = {
      version: 1,
      eventId: event.id,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    };
    const encoded = JSON.stringify(envelope);
    if (Buffer.byteLength(encoded, "utf8") > this.#maximumPayloadBytes) {
      throw new PermanentOutboxPublishError();
    }
    await this.#queue.add(event.eventType, envelope, {
      ...this.#jobOptions,
      jobId: event.id,
      priority: this.#priorityEventTypes.has(event.eventType) ? 1 : 10,
    });
  }
}
