import { randomUUID } from "node:crypto";
import { OutboxStatus } from "../generated/prisma/client";
import { OutboxEventRepository } from "../src/repositories/outbox-event.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("OutboxEventRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("claims disjoint batches with SKIP LOCKED and confirms only the current attempt", async () => {
    const repository = new OutboxEventRepository(database.client);
    const now = new Date("2026-07-28T22:30:00.000Z");
    const eventIds = [randomUUID(), randomUUID()];
    try {
      for (const [index, id] of eventIds.entries()) {
        await repository.append({
          id,
          aggregateType: "LISTING",
          aggregateId: randomUUID(),
          eventType: "listing.submitted",
          payload: { version: index + 1 },
          availableAt: new Date(now.getTime() - 1_000),
          createdAt: new Date(now.getTime() - 10_000),
        });
      }

      const [first, second] = await Promise.all([
        repository.claimBatch({ now, batchSize: 1, leaseSeconds: 60 }),
        repository.claimBatch({ now, batchSize: 1, leaseSeconds: 60 }),
      ]);
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0]?.id).not.toBe(second[0]?.id);
      const claim = first[0]!;
      await expect(
        repository.markPublished({
          id: claim.id,
          attempt: claim.attempt + 1,
          publishedAt: now,
        }),
      ).resolves.toBe(false);
      await expect(
        repository.markPublished({ id: claim.id, attempt: claim.attempt, publishedAt: now }),
      ).resolves.toBe(true);
      await expect(
        database.client.outboxEvent.findUniqueOrThrow({ where: { id: claim.id } }),
      ).resolves.toMatchObject({
        status: OutboxStatus.PUBLISHED,
        attempts: 1,
        publishedAt: now,
        lastError: null,
      });
    } finally {
      await database.client.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
  });

  it("leases retries, preserves bounded error evidence, and terminally fails at the limit", async () => {
    const repository = new OutboxEventRepository(database.client);
    const id = randomUUID();
    const now = new Date("2026-07-28T22:30:00.000Z");
    const retryAt = new Date(now.getTime() + 5_000);
    try {
      await repository.append({
        id,
        aggregateType: "MEDIA",
        aggregateId: randomUUID(),
        eventType: "media.uploaded",
        payload: { version: 1 },
        availableAt: now,
        createdAt: new Date(now.getTime() - 30_000),
      });
      const first = (await repository.claimBatch({ now, batchSize: 1, leaseSeconds: 60 }))[0]!;
      await expect(
        repository.markFailed({
          id,
          attempt: first.attempt,
          now,
          retryAt,
          errorCode: "redis connection private@example.com",
          maximumAttempts: 2,
        }),
      ).resolves.toBe("retry");
      await expect(
        repository.claimBatch({
          now: new Date(retryAt.getTime() - 1),
          batchSize: 1,
          leaseSeconds: 60,
        }),
      ).resolves.toHaveLength(0);

      const second = (
        await repository.claimBatch({ now: retryAt, batchSize: 1, leaseSeconds: 60 })
      )[0]!;
      expect(second.attempt).toBe(2);
      await expect(
        repository.markFailed({
          id,
          attempt: second.attempt,
          now: retryAt,
          retryAt: new Date(retryAt.getTime() + 10_000),
          errorCode: "REDIS_CONNECTION_FAILED",
          maximumAttempts: 2,
        }),
      ).resolves.toBe("failed");
      await expect(
        database.client.outboxEvent.findUniqueOrThrow({ where: { id } }),
      ).resolves.toMatchObject({
        status: OutboxStatus.FAILED,
        attempts: 2,
        publishedAt: null,
        lastError: "REDIS_CONNECTION_FAILED",
      });
    } finally {
      await database.client.outboxEvent.deleteMany({ where: { id } });
    }
  });

  it("claims urgent removal events ahead of older normal work", async () => {
    const repository = new OutboxEventRepository(database.client);
    const now = new Date("2026-07-29T18:00:00.000Z");
    const normalId = randomUUID();
    const urgentId = randomUUID();
    try {
      await repository.append({
        id: normalId,
        aggregateType: "LISTING",
        aggregateId: randomUUID(),
        eventType: "listing.published",
        payload: { schemaVersion: 1 },
        availableAt: new Date(now.getTime() - 10_000),
        createdAt: new Date(now.getTime() - 10_000),
      });
      await repository.append({
        id: urgentId,
        aggregateType: "LISTING",
        aggregateId: randomUUID(),
        eventType: "listing.deleted",
        payload: { schemaVersion: 1 },
        availableAt: new Date(now.getTime() - 1_000),
        createdAt: new Date(now.getTime() - 1_000),
      });

      await expect(
        repository.claimBatch({
          now,
          batchSize: 1,
          leaseSeconds: 60,
          priorityEventTypes: ["listing.deleted"],
        }),
      ).resolves.toMatchObject([{ id: urgentId, eventType: "listing.deleted" }]);
    } finally {
      await database.client.outboxEvent.deleteMany({
        where: { id: { in: [normalId, urgentId] } },
      });
    }
  });
});
