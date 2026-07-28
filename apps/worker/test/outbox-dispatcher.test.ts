import { randomUUID } from "node:crypto";
import { createObservabilityRuntime } from "@socal/observability";
import { describe, expect, it } from "vitest";
import {
  OutboxDispatcher,
  PermanentOutboxPublishError,
  type OutboxPublisher,
  type OutboxRepository,
} from "../src/outbox/outbox-dispatcher";

const now = new Date("2026-07-28T22:30:00.000Z");

function event(overrides: { id?: string; eventType?: string; attempt?: number } = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    aggregateType: "LISTING",
    aggregateId: randomUUID(),
    eventType: overrides.eventType ?? "listing.submitted",
    payload: { listingVersion: 7 },
    attempt: overrides.attempt ?? 1,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    createdAt: new Date(now.getTime() - 12_000),
  };
}

function runtime(records: string[]) {
  return createObservabilityRuntime({
    serviceName: "outbox-test",
    serviceVersion: "0.1.0",
    environment: "test",
    logSink: (record) => records.push(record),
  });
}

describe("OutboxDispatcher", () => {
  it("publishes claims, confirms the exact attempt, and exposes bounded oldest-age metrics", async () => {
    const records: string[] = [];
    const claimed = event();
    const published: string[] = [];
    const repository: OutboxRepository = {
      claimBatch: () => Promise.resolve([claimed]),
      markPublished: (input) => {
        expect(input).toEqual({ id: claimed.id, attempt: 1, publishedAt: now });
        return Promise.resolve(true);
      },
      markFailed: () => Promise.reject(new Error("unexpected failure path")),
      oldestPendingAgeSeconds: () => Promise.resolve(12),
    };
    const publisher: OutboxPublisher = {
      publish: (input) => {
        published.push(input.id);
        return Promise.resolve();
      },
    };
    const observability = runtime(records);
    const dispatcher = new OutboxDispatcher({
      repository,
      publisher,
      observability,
      configuration: {
        batchSize: 25,
        leaseSeconds: 60,
        maximumAttempts: 10,
        retryBaseSeconds: 5,
        retryMaximumSeconds: 900,
        pollIntervalMilliseconds: 1_000,
      },
    });

    await expect(dispatcher.dispatchOnce(now)).resolves.toEqual({
      claimed: 1,
      published: 1,
      retry: 0,
      failed: 0,
      stale: 0,
      oldestPendingAgeSeconds: 12,
    });
    expect(published).toEqual([claimed.id]);
    const metrics = observability.metrics.renderPrometheus();
    expect(metrics).toContain('socal_outbox_dispatch_total{outcome="published"} 1');
    expect(metrics).toContain("socal_outbox_oldest_pending_age_seconds 12");
    expect(records.join("\n")).not.toContain("listingVersion");
  });

  it("schedules retry without logging provider detail and terminally rejects invalid events", async () => {
    const records: string[] = [];
    const retryEvent = event({ id: "10000000-0000-4000-8000-000000000001" });
    const invalidEvent = event({
      id: "10000000-0000-4000-8000-000000000002",
      eventType: "Invalid Event",
    });
    const failures: Array<Record<string, unknown>> = [];
    const repository: OutboxRepository = {
      claimBatch: () => Promise.resolve([retryEvent, invalidEvent]),
      markPublished: () => Promise.resolve(false),
      markFailed: (input) => {
        failures.push(input);
        return Promise.resolve(input.terminal ? "failed" : "retry");
      },
      oldestPendingAgeSeconds: () => Promise.resolve(30),
    };
    const publisher: OutboxPublisher = {
      publish: (input) =>
        input.id === invalidEvent.id
          ? Promise.reject(new PermanentOutboxPublishError())
          : Promise.reject(new Error("Redis leaked private@example.com")),
    };
    const observability = runtime(records);
    const dispatcher = new OutboxDispatcher({
      repository,
      publisher,
      observability,
      configuration: {
        batchSize: 25,
        leaseSeconds: 60,
        maximumAttempts: 10,
        retryBaseSeconds: 5,
        retryMaximumSeconds: 900,
        pollIntervalMilliseconds: 1_000,
      },
    });

    await expect(dispatcher.dispatchOnce(now)).resolves.toMatchObject({
      claimed: 2,
      retry: 1,
      failed: 1,
    });
    expect(failures[0]).toMatchObject({
      id: retryEvent.id,
      attempt: 1,
      errorCode: "OUTBOX_PUBLISH_FAILED",
      maximumAttempts: 10,
      terminal: false,
    });
    expect((failures[0]?.retryAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(failures[1]).toMatchObject({
      id: invalidEvent.id,
      errorCode: "OUTBOX_EVENT_INVALID",
      terminal: true,
    });
    const combined = records.join("\n");
    expect(combined).not.toContain("private@example.com");
    expect(combined).not.toContain("Redis leaked");
  });
});
