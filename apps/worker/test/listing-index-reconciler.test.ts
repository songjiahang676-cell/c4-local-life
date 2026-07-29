import { createObservabilityRuntime } from "@socal/observability";
import { describe, expect, it, vi } from "vitest";
import { ListingIndexReconciler } from "../src/search/listing-index-reconciler";

const now = new Date("2026-07-29T18:00:00.000Z");

describe("ListingIndexReconciler", () => {
  it("repairs missing/stale projections and advances a bounded cursor", async () => {
    const records: string[] = [];
    const synchronize = vi.fn(() =>
      Promise.resolve({ operation: "upsert" as const, outcome: "applied" as const, version: 3 }),
    );
    const runtime = createObservabilityRuntime({
      serviceName: "search-reconciliation-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });
    const reconciler = new ListingIndexReconciler({
      repository: {
        listStates: () =>
          Promise.resolve({
            items: [
              { id: "10000000-0000-4000-8000-000000000001", version: 3, shouldIndex: true },
              { id: "10000000-0000-4000-8000-000000000002", version: 4, shouldIndex: false },
              { id: "10000000-0000-4000-8000-000000000003", version: 5, shouldIndex: true },
            ],
            nextCursor: "10000000-0000-4000-8000-000000000003",
          }),
      },
      index: {
        version: (id) => Promise.resolve(id.endsWith("1") ? 2 : id.endsWith("2") ? 4 : 5),
      },
      handler: { synchronize },
      observability: runtime,
      configuration: { batchSize: 100, intervalMilliseconds: 300_000 },
    });

    await expect(reconciler.reconcileOnce(now)).resolves.toEqual({
      current: 1,
      repaired: 2,
      scanned: 3,
      nextCursor: "10000000-0000-4000-8000-000000000003",
    });
    expect(synchronize).toHaveBeenCalledTimes(2);
    expect(synchronize).toHaveBeenNthCalledWith(
      1,
      "10000000-0000-4000-8000-000000000001",
      3,
      now,
      "normal",
      now,
    );
    expect(synchronize).toHaveBeenNthCalledWith(
      2,
      "10000000-0000-4000-8000-000000000002",
      4,
      now,
      "normal",
      now,
    );
    const metrics = runtime.metrics.renderPrometheus();
    expect(metrics).toContain('socal_search_reconciliation_total{outcome="current"} 1');
    expect(metrics).toContain('socal_search_reconciliation_total{outcome="upserted"} 1');
    expect(metrics).toContain('socal_search_reconciliation_total{outcome="deleted"} 1');
    expect(records.join("\n")).toContain('"scanned":3');
    expect(records.join("\n")).not.toContain("10000000-0000-4000");
  });

  it("records scheduled failures without logging provider or document details", async () => {
    vi.useFakeTimers();
    const records: string[] = [];
    const runtime = createObservabilityRuntime({
      serviceName: "search-reconciliation-failure-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });
    const reconciler = new ListingIndexReconciler({
      repository: {
        listStates: () =>
          Promise.reject(new Error("OpenSearch leaked private-listing@example.invalid")),
      },
      index: { version: () => Promise.resolve(null) },
      handler: {
        synchronize: () => Promise.resolve({ operation: "delete", outcome: "missing", version: 1 }),
      },
      observability: runtime,
      configuration: { batchSize: 100, intervalMilliseconds: 10_000 },
    });

    reconciler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await reconciler.stop();
    vi.useRealTimers();

    expect(runtime.metrics.renderPrometheus()).toContain(
      'socal_search_reconciliation_total{outcome="failed"} 1',
    );
    expect(records.join("\n")).toContain('"errorCode":"SEARCH_RECONCILIATION_FAILED"');
    expect(records.join("\n")).not.toContain("private-listing@example.invalid");
  });
});
