import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BullMqOutboxPublisher } from "../src/outbox/bullmq-outbox.publisher";

const redisUrl = process.env.REDIS_INTEGRATION_URL ?? "";
const integration = describe.skipIf(redisUrl.length === 0);

integration("BullMqOutboxPublisher with Redis", () => {
  let connection: IORedis;
  let queue: Queue;

  beforeAll(() => {
    connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue(`outbox-integration-${randomUUID()}`, { connection });
  });

  afterAll(async () => {
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    if (connection) await connection.quit();
  });

  it("persists one versioned job for repeated delivery of the same eventId", async () => {
    const publisher = new BullMqOutboxPublisher(queue, {
      maximumPayloadBytes: 131_072,
      jobAttempts: 8,
    });
    const eventId = randomUUID();
    const event = {
      id: eventId,
      aggregateType: "MEDIA",
      aggregateId: randomUUID(),
      eventType: "media.uploaded",
      payload: { mediaVersion: 1 },
      attempt: 1,
      leaseExpiresAt: new Date("2026-07-28T22:31:00.000Z"),
      createdAt: new Date("2026-07-28T22:30:00.000Z"),
    };

    await publisher.publish(event);
    await publisher.publish({ ...event, attempt: 2 });

    const persisted = await queue.getJob(eventId);
    expect(persisted?.id).toBe(eventId);
    expect(persisted?.name).toBe("media.uploaded");
    expect(persisted?.data).toMatchObject({
      version: 1,
      eventId,
      aggregateId: event.aggregateId,
      payload: { mediaVersion: 1 },
    });
    await expect(queue.count()).resolves.toBe(1);
  });
});
