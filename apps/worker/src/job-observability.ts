import { randomUUID } from "node:crypto";
import {
  finishSpan,
  runInSpanContext,
  runWithObservabilityContext,
  startConsumerSpan,
  traceFields,
  type ObservabilityRuntime,
} from "@socal/observability";

export type ObservableJob = {
  id?: string | number;
  name: string;
  data?: unknown;
};

type JobTelemetryEnvelope = {
  requestId?: string;
  traceparent?: string;
  tracestate?: string;
};

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const jobNamePattern = /^[a-z][a-z0-9.-]{0,79}$/;

function telemetryEnvelope(data: unknown): JobTelemetryEnvelope {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const dataRecord = data as Record<string, unknown>;
  const telemetry = dataRecord.telemetry;
  if (!telemetry || typeof telemetry !== "object" || Array.isArray(telemetry)) return {};

  const telemetryRecord = telemetry as Record<string, unknown>;
  const requestId = telemetryRecord.requestId;
  const traceparent = telemetryRecord.traceparent;
  const tracestate = telemetryRecord.tracestate;
  return {
    requestId: typeof requestId === "string" ? requestId : undefined,
    traceparent: typeof traceparent === "string" ? traceparent : undefined,
    tracestate: typeof tracestate === "string" ? tracestate : undefined,
  };
}

export async function runObservedJob(
  job: ObservableJob,
  handler: () => Promise<void>,
  observability: ObservabilityRuntime,
): Promise<void> {
  const telemetry = telemetryEnvelope(job.data);
  const requestId =
    telemetry.requestId && requestIdPattern.test(telemetry.requestId)
      ? telemetry.requestId
      : randomUUID();
  const jobName = jobNamePattern.test(job.name) ? job.name : "unknown";
  const jobId = job.id === undefined ? "unknown" : String(job.id).slice(0, 128);
  const span = startConsumerSpan(
    `job ${jobName}`,
    {
      traceparent: telemetry.traceparent,
      tracestate: telemetry.tracestate,
    },
    {
      "messaging.system": "bullmq",
      "messaging.destination.name": "platform-events",
      "messaging.operation.name": "process",
      "messaging.operation.type": "process",
      "job.name": jobName,
    },
  );
  const trace = traceFields(span);
  const startedAt = process.hrtime.bigint();
  observability.metrics.workerJobStarted();

  await runWithObservabilityContext(
    { requestId, jobId, jobName, traceId: trace.traceId, spanId: trace.spanId },
    () =>
      runInSpanContext(span, async () => {
        observability.logger.info("worker.job.started", { jobId, jobName });
        try {
          await handler();
          const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
          observability.metrics.observeWorkerJob({
            jobName,
            outcome: "completed",
            durationSeconds,
          });
          observability.logger.info("worker.job.completed", {
            jobId,
            jobName,
            durationMs: Math.round(durationSeconds * 1_000),
            outcome: "completed",
          });
          finishSpan(span, "ok");
        } catch (error: unknown) {
          const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
          observability.metrics.observeWorkerJob({
            jobName,
            outcome: "failed",
            durationSeconds,
          });
          observability.logger.error("worker.job.failed", {
            jobId,
            jobName,
            durationMs: Math.round(durationSeconds * 1_000),
            outcome: "failed",
            errorCode: "JOB_HANDLER_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
          finishSpan(span, "error", error instanceof Error ? error.name : "UnknownError");
          throw error;
        }
      }),
  );
}
