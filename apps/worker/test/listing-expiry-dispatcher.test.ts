import { createObservabilityRuntime } from "@socal/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ListingExpiryDispatcher,
  type ListingExpiryRepository,
} from "../src/listing/listing-expiry-dispatcher";

const now = new Date("2026-07-29T06:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("ListingExpiryDispatcher", () => {
  it("runs a bounded poll and exposes counts without resource identifiers", async () => {
    const records: string[] = [];
    const calls: Array<{ now: Date; limit: number }> = [];
    const repository: ListingExpiryRepository = {
      expireDue: (input) => {
        calls.push(input);
        return Promise.resolve({ expiredCount: 2 });
      },
    };
    const observability = createObservabilityRuntime({
      serviceName: "listing-expiry-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });
    const dispatcher = new ListingExpiryDispatcher({
      repository,
      observability,
      configuration: {
        batchSize: 50,
        pollIntervalMilliseconds: 30_000,
      },
    });

    await expect(dispatcher.dispatchOnce(now)).resolves.toEqual({ expiredCount: 2 });
    expect(calls).toEqual([{ now, limit: 50 }]);
    const metrics = observability.metrics.renderPrometheus();
    expect(metrics).toContain('socal_listing_expiry_polls_total{outcome="expired"} 1');
    expect(metrics).toContain("socal_listings_expired_total 2");
    expect(records.join("\n")).toContain('"expiredCount":2');
    expect(records.join("\n")).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  it("records an idle poll without inflating the expired resource counter", async () => {
    const repository: ListingExpiryRepository = {
      expireDue: () => Promise.resolve({ expiredCount: 0 }),
    };
    const observability = createObservabilityRuntime({
      serviceName: "listing-expiry-idle-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: () => undefined,
    });
    const dispatcher = new ListingExpiryDispatcher({
      repository,
      observability,
      configuration: {
        batchSize: 25,
        pollIntervalMilliseconds: 60_000,
      },
    });

    await dispatcher.dispatchOnce(now);
    const metrics = observability.metrics.renderPrometheus();
    expect(metrics).toContain('socal_listing_expiry_polls_total{outcome="idle"} 1');
    expect(metrics).toContain("socal_listings_expired_total 0");
  });

  it("records a bounded scheduled-poll failure without leaking provider detail", async () => {
    vi.useFakeTimers();
    const records: string[] = [];
    const repository: ListingExpiryRepository = {
      expireDue: () =>
        Promise.reject(new Error("PostgreSQL leaked private-listing@example.invalid")),
    };
    const observability = createObservabilityRuntime({
      serviceName: "listing-expiry-failure-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });
    const dispatcher = new ListingExpiryDispatcher({
      repository,
      observability,
      configuration: {
        batchSize: 25,
        pollIntervalMilliseconds: 60_000,
      },
    });

    dispatcher.start();
    await vi.advanceTimersByTimeAsync(0);
    await dispatcher.stop();

    const metrics = observability.metrics.renderPrometheus();
    expect(metrics).toContain("socal_listing_expiry_poll_failures_total 1");
    expect(records.join("\n")).toContain('"errorCode":"LISTING_EXPIRY_POLL_FAILED"');
    expect(records.join("\n")).not.toContain("private-listing@example.invalid");
  });
});
