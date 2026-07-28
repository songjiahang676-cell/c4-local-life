import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BullMqOutboxPublisher } from "../src/outbox/bullmq-outbox.publisher";
import { PermanentOutboxPublishError } from "../src/outbox/outbox-dispatcher";

describe("BullMqOutboxPublisher", () => {
  it("uses the immutable event ID as the BullMQ idempotency key", async () => {
    const add = vi.fn(() => Promise.resolve({}));
    const publisher = new BullMqOutboxPublisher(
      { add },
      {
        maximumPayloadBytes: 131_072,
        jobAttempts: 8,
      },
    );
    const id = randomUUID();
    const aggregateId = randomUUID();

    await publisher.publish({
      id,
      aggregateType: "LISTING",
      aggregateId,
      eventType: "listing.submitted",
      payload: { version: 3 },
      attempt: 1,
      leaseExpiresAt: new Date("2026-07-28T22:31:00.000Z"),
      createdAt: new Date("2026-07-28T22:30:00.000Z"),
    });

    expect(add).toHaveBeenCalledWith(
      "listing.submitted",
      {
        version: 1,
        eventId: id,
        aggregateType: "LISTING",
        aggregateId,
        eventType: "listing.submitted",
        occurredAt: "2026-07-28T22:30:00.000Z",
        payload: { version: 3 },
      },
      expect.objectContaining({
        jobId: id,
        attempts: 8,
        backoff: { type: "exponential", delay: 1_000 },
      }),
    );
  });

  it("permanently rejects invalid event names and oversized envelopes before Redis", async () => {
    const add = vi.fn(() => Promise.resolve({}));
    const publisher = new BullMqOutboxPublisher(
      { add },
      {
        maximumPayloadBytes: 256,
        jobAttempts: 3,
      },
    );
    const base = {
      id: randomUUID(),
      aggregateType: "LISTING",
      aggregateId: randomUUID(),
      payload: {},
      attempt: 1,
      leaseExpiresAt: new Date("2026-07-28T22:31:00.000Z"),
      createdAt: new Date("2026-07-28T22:30:00.000Z"),
    };

    await expect(publisher.publish({ ...base, eventType: "Invalid Event" })).rejects.toBeInstanceOf(
      PermanentOutboxPublishError,
    );
    await expect(
      publisher.publish({
        ...base,
        eventType: "listing.submitted",
        payload: { body: "x".repeat(1_000) },
      }),
    ).rejects.toBeInstanceOf(PermanentOutboxPublishError);
    expect(add).not.toHaveBeenCalled();
  });
});
