import { describe, expect, it } from "vitest";
import {
  createObservabilityRuntime,
  finishSpan,
  runWithObservabilityContext,
  startServerSpan,
  traceFields,
} from "../src";

describe("observability primitives", () => {
  it("emits structured context while redacting PII, credentials, and message bodies", () => {
    const records: string[] = [];
    const runtime = createObservabilityRuntime({
      serviceName: "observability-test",
      serviceVersion: "1.2.3",
      environment: "test",
      logSink: (record) => records.push(record),
    });

    runWithObservabilityContext(
      { requestId: "request-1", traceId: "1".repeat(32), spanId: "2".repeat(16) },
      () =>
        runtime.logger.info("privacy.redaction.checked", {
          email: "person@example.com",
          phone: "(949) 555-0100",
          authorization: "Bearer private-token",
          body: "private message text",
          note: "Contact person@example.com or 949-555-0100",
          cardHint: "4111 1111 1111 1111",
        }),
    );

    expect(records).toHaveLength(1);
    const serialized = records[0] ?? "";
    const record = JSON.parse(serialized) as Record<string, unknown>;
    expect(record).toMatchObject({
      event: "privacy.redaction.checked",
      level: "info",
      service: "observability-test",
      environment: "test",
      version: "1.2.3",
      requestId: "request-1",
      traceId: "1".repeat(32),
    });
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("949-555-0100");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private message text");
    expect(serialized).not.toContain("4111 1111 1111 1111");
  });

  it("uses W3C propagation and records bounded RED/worker metrics", () => {
    const parentTraceId = "a".repeat(32);
    const span = startServerSpan(
      "HTTP GET",
      { traceparent: `00-${parentTraceId}-${"b".repeat(16)}-01` },
      { "http.request.method": "GET" },
    );
    const fields = traceFields(span);
    finishSpan(span, "ok");

    expect(fields.traceId).toBe(parentTraceId);
    expect(fields.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);

    const runtime = createObservabilityRuntime({
      serviceName: "metrics-test",
      serviceVersion: "1.0.0",
      environment: "test",
      logSink: () => undefined,
    });
    runtime.metrics.httpRequestStarted();
    runtime.metrics.observeHttpRequest({
      method: "GET",
      route: "/v1/listings/:id",
      statusCode: 200,
      durationSeconds: 0.02,
    });
    runtime.metrics.workerJobStarted();
    runtime.metrics.observeWorkerJob({
      jobName: "search.index",
      outcome: "completed",
      durationSeconds: 0.1,
    });
    runtime.metrics.mediaProcessing("ready");
    runtime.metrics.notificationEvent("created");
    runtime.metrics.moderationDuplicateReview("false_positive", 2);
    runtime.metrics.searchIndex({
      operation: "delete",
      outcome: "applied",
      priority: "urgent",
      freshnessSeconds: 7,
    });
    runtime.metrics.searchIndex({
      operation: "upsert",
      outcome: "failed",
      priority: "normal",
      freshnessSeconds: 900,
    });
    runtime.metrics.searchReconciliation("deleted");

    const metrics = runtime.metrics.renderPrometheus();
    expect(metrics).toContain(
      'socal_http_requests_total{method="GET",route="/v1/listings/:id",status_class="2xx"} 1',
    );
    expect(metrics).toContain(
      'socal_worker_jobs_total{job_name="search.index",outcome="completed"} 1',
    );
    expect(metrics).toContain('socal_media_processing_total{outcome="ready"} 1');
    expect(metrics).toContain('socal_notification_events_total{outcome="created"} 1');
    expect(metrics).toContain(
      'socal_moderation_duplicate_reviews_total{outcome="false_positive"} 2',
    );
    expect(metrics).toContain(
      'socal_search_index_events_total{operation="delete",outcome="applied",priority="urgent"} 1',
    );
    expect(metrics).toContain(
      'socal_search_index_freshness_seconds_bucket{operation="delete",priority="urgent",le="10"} 1',
    );
    expect(metrics).toContain(
      'socal_search_index_events_total{operation="upsert",outcome="failed",priority="normal"} 1',
    );
    expect(metrics).not.toContain(
      'socal_search_index_freshness_seconds_count{operation="upsert",priority="normal"}',
    );
    expect(metrics).toContain('socal_search_reconciliation_total{outcome="deleted"} 1');
    expect(metrics).not.toContain("person@example.com");
  });
});
