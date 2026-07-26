import { createServer, type ServerResponse } from "node:http";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { parseWorkerEnvironment, RuntimeConfigError, runtimeConfigSummary } from "@socal/config";
import {
  createObservabilityRuntime,
  shutdownTracing,
  type ObservabilityRuntime,
} from "@socal/observability";
import { workerLiveness, workerReadiness } from "./health-status";
import { runObservedJob } from "./job-observability";

const runtimeState: { observability?: ObservabilityRuntime } = {};
process.on("uncaughtException", (error: Error) => {
  const configurationError = error instanceof RuntimeConfigError;
  const fields = {
    errorCode: configurationError ? error.code : "UNCAUGHT_EXCEPTION",
    errorType: error.name,
  };
  if (runtimeState.observability) {
    runtimeState.observability.logger.fatal("worker.uncaught", fields);
  } else {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "fatal",
        event: "worker.uncaught",
        service: "socal-worker",
        environment: process.env.APP_ENV ?? "unknown",
        version: process.env.OTEL_SERVICE_VERSION ?? "unknown",
        ...fields,
      }),
    );
  }
  process.exit(1);
});

const environment = parseWorkerEnvironment(process.env);
runtimeState.observability = createObservabilityRuntime({
  serviceName: environment.OTEL_SERVICE_NAME || "socal-worker",
  serviceVersion: environment.OTEL_SERVICE_VERSION,
  environment: environment.APP_ENV,
  minimumLogLevel: environment.LOG_LEVEL,
  otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
});
const connection = new IORedis(environment.REDIS_URL, { maxRetriesPerRequest: null });

function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  runtimeState.observability?.logger.info(event, fields);
}

const handlers: Record<string, (job: Job) => Promise<void>> = {
  "search.index": () => Promise.resolve(),
  "media.scan": () => Promise.resolve(),
  "notification.dispatch": () => Promise.resolve(),
};

const worker = new Worker(
  "platform-events",
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`No handler registered for job ${job.name}`);
    if (!runtimeState.observability) throw new Error("Observability runtime is unavailable");
    await runObservedJob(job, () => handler(job), runtimeState.observability);
  },
  { connection, concurrency: environment.WORKER_CONCURRENCY },
);

worker.on("error", () =>
  runtimeState.observability?.logger.error("worker.queue.error", { errorCode: "QUEUE_ERROR" }),
);

function sendHealthResponse(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const healthServer = createServer((request, response) => {
  if (request.method !== "GET") {
    sendHealthResponse(response, 405, { status: "error" });
    return;
  }

  if (request.url === "/health/live") {
    const { statusCode, body } = workerLiveness();
    sendHealthResponse(response, statusCode, body);
    return;
  }

  if (request.url === "/health/ready") {
    const { statusCode, body } = workerReadiness(connection.status === "ready");
    sendHealthResponse(response, statusCode, body);
    return;
  }

  if (request.url === "/metrics") {
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(runtimeState.observability?.metrics.renderPrometheus() ?? "");
    return;
  }

  sendHealthResponse(response, 404, { status: "not-found" });
});

healthServer.on("error", (error) => {
  logEvent("worker.health.failed", { message: error.message });
  process.exitCode = 1;
});
healthServer.listen(environment.WORKER_HEALTH_PORT, "0.0.0.0");

async function shutdown(signal: string): Promise<void> {
  logEvent("worker.shutdown.started", { signal });
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
  await worker.close();
  await connection.quit();
  await shutdownTracing();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logEvent("worker.started", {
  concurrency: environment.WORKER_CONCURRENCY,
  healthPort: environment.WORKER_HEALTH_PORT,
  queue: "platform-events",
  ...runtimeConfigSummary(environment),
});
