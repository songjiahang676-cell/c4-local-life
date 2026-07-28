import { createObservabilityRuntime } from "@socal/observability";
import { describe, expect, it } from "vitest";
import { runObservedJob } from "../src/job-observability";

describe("worker job observability", () => {
  it("propagates request/trace IDs without logging the job payload", async () => {
    const records: string[] = [];
    const runtime = createObservabilityRuntime({
      serviceName: "worker-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });
    const parentTraceId = "c".repeat(32);

    await runObservedJob(
      {
        id: "job-1",
        name: "search.index",
        data: {
          telemetry: {
            requestId: "source-request-1",
            traceparent: `00-${parentTraceId}-${"d".repeat(16)}-01`,
          },
          email: "private@example.com",
          body: "must never be logged",
        },
      },
      () => Promise.resolve(),
      runtime,
    );

    expect(records).toHaveLength(2);
    const combined = records.join("\n");
    const completed = JSON.parse(records[1] ?? "{}") as Record<string, unknown>;
    expect(completed).toMatchObject({
      event: "worker.job.completed",
      requestId: "source-request-1",
      traceId: parentTraceId,
      jobId: "job-1",
      jobName: "search.index",
      outcome: "completed",
    });
    expect(combined).not.toContain("private@example.com");
    expect(combined).not.toContain("must never be logged");
    expect(runtime.metrics.renderPrometheus()).toContain(
      'socal_worker_jobs_total{job_name="search.index",outcome="completed"} 1',
    );
  });

  it("classifies handler failures without serializing provider errors", async () => {
    const records: string[] = [];
    const runtime = createObservabilityRuntime({
      serviceName: "worker-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => records.push(record),
    });

    await expect(
      runObservedJob(
        { id: "job-2", name: "media.upload.completed" },
        () => Promise.reject(new Error("provider leaked private@example.com")),
        runtime,
      ),
    ).rejects.toThrow("provider leaked");

    const combined = records.join("\n");
    expect(combined).toContain('"errorCode":"JOB_HANDLER_FAILED"');
    expect(combined).not.toContain("private@example.com");
    expect(combined).not.toContain("provider leaked");
  });
});
