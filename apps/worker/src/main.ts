import { createServer, type ServerResponse } from "node:http";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { parseWorkerEnvironment, RuntimeConfigError, runtimeConfigSummary } from "@socal/config";
import { MediaAssetRepository } from "@socal/database/media";
import { ListingRepository } from "@socal/database/listing";
import { ListingSearchRepository } from "@socal/database/listing-search";
import {
  NotificationRepository,
  listingNotificationEventTypes,
  organizationInvitationNotificationEventTypes,
} from "@socal/database/notification";
import { OutboxEventRepository } from "@socal/database/outbox";
import { QueueOperationsRepository } from "@socal/database/queue-operations";
import {
  createObservabilityRuntime,
  shutdownTracing,
  type ObservabilityRuntime,
} from "@socal/observability";
import { workerLiveness, workerReadiness } from "./health-status";
import {
  HomepageCacheInvalidationHandler,
  homepageLayoutPublishedEventType,
  PermanentHomepageCacheInvalidationError,
} from "./homepage/homepage-cache-invalidation";
import { RedisHomepageCacheInvalidator } from "./homepage/redis-homepage-cache-invalidator";
import { runObservedJob } from "./job-observability";
import { ListingExpiryDispatcher } from "./listing/listing-expiry-dispatcher";
import {
  ListingNotificationHandler,
  PermanentListingNotificationError,
} from "./notification/listing-notification";
import {
  OrganizationInvitationNotificationHandler,
  PermanentOrganizationInvitationNotificationError,
} from "./notification/organization-invitation-notification";
import { ClamAvScanner } from "./media/clamav-scanner";
import { MediaProcessingHandler, PermanentMediaProcessingError } from "./media/media-processing";
import { S3MediaProcessingStorage } from "./media/s3-media-processing.storage";
import { SharpImageTransformer } from "./media/sharp-image-transformer";
import { BullMqOutboxPublisher } from "./outbox/bullmq-outbox.publisher";
import { OutboxDispatcher } from "./outbox/outbox-dispatcher";
import { recordTerminalJobFailure } from "./queue-operations/queue-failure-recorder";
import { QueueOperationsDispatcher } from "./queue-operations/queue-operations-dispatcher";
import {
  ListingIndexHandler,
  ListingSearchProjectionError,
  PermanentListingSearchEventError,
  listingSearchEventTypes,
  urgentListingSearchEventTypes,
} from "./search/listing-index-handler";
import { ListingIndexReconciler } from "./search/listing-index-reconciler";
import { listingIndexNames } from "./search/listing-index-definition";
import { OpenSearchListingIndex } from "./search/listing-index";
import { createOpenSearchClient } from "./search/opensearch-client";

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
const outboxRepository = new OutboxEventRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const queueOperationsRepository = new QueueOperationsRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const mediaRepository = new MediaAssetRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const listingRepository = new ListingRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const listingSearchRepository = new ListingSearchRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const notificationRepository = new NotificationRepository({
  connectionString: environment.DATABASE_URL,
  poolMaximum: environment.DATABASE_POOL_MAX,
});
const mediaStorage = new S3MediaProcessingStorage(environment);
const mediaProcessing = new MediaProcessingHandler(
  mediaRepository,
  mediaStorage,
  new ClamAvScanner({
    host: environment.CLAMAV_HOST,
    port: environment.CLAMAV_PORT,
    timeoutMilliseconds: environment.CLAMAV_TIMEOUT_MS,
  }),
  new SharpImageTransformer(environment.MEDIA_IMAGE_MAX_PIXELS),
  {
    maximumBytes: environment.MEDIA_PROCESS_MAX_BYTES,
    processedBucket: environment.S3_MEDIA_BUCKET,
    onOutcome: (outcome) => runtimeState.observability?.metrics.mediaProcessing(outcome),
  },
);
const outboxQueue = new Queue(environment.OUTBOX_QUEUE_NAME, { connection });
const outboxPublisher = new BullMqOutboxPublisher(outboxQueue, {
  maximumPayloadBytes: environment.OUTBOX_MAX_PAYLOAD_BYTES,
  jobAttempts: environment.OUTBOX_JOB_ATTEMPTS,
  priorityEventTypes: urgentListingSearchEventTypes,
});
const openSearchClient = createOpenSearchClient({
  node: environment.OPENSEARCH_NODE,
  ...(environment.OPENSEARCH_USERNAME
    ? {
        username: environment.OPENSEARCH_USERNAME,
        password: environment.OPENSEARCH_PASSWORD,
      }
    : {}),
});
const listingIndexNamesValue = listingIndexNames(environment.OPENSEARCH_INDEX_PREFIX);
const listingIndex = new OpenSearchListingIndex(
  openSearchClient,
  listingIndexNamesValue.readAlias,
  listingIndexNamesValue.writeAlias,
);
const outboxDispatcher = new OutboxDispatcher({
  repository: outboxRepository,
  publisher: outboxPublisher,
  observability: runtimeState.observability,
  configuration: {
    batchSize: environment.OUTBOX_BATCH_SIZE,
    leaseSeconds: environment.OUTBOX_LEASE_SECONDS,
    maximumAttempts: environment.OUTBOX_MAX_ATTEMPTS,
    pollIntervalMilliseconds: environment.OUTBOX_POLL_INTERVAL_MS,
    retryBaseSeconds: environment.OUTBOX_RETRY_BASE_SECONDS,
    retryMaximumSeconds: environment.OUTBOX_RETRY_MAX_SECONDS,
    priorityEventTypes: urgentListingSearchEventTypes,
  },
});
const queueOperationsDispatcher = new QueueOperationsDispatcher({
  repository: queueOperationsRepository,
  queue: {
    getJob: (id) => outboxQueue.getJob(id),
    getJobs: (types, start, end, asc) =>
      outboxQueue.getJobs(types as Parameters<typeof outboxQueue.getJobs>[0], start, end, asc),
  },
  publisher: outboxPublisher,
  observability: runtimeState.observability,
  pollIntervalMilliseconds: Math.max(1_000, environment.OUTBOX_POLL_INTERVAL_MS),
  leaseSeconds: Math.max(60, environment.OUTBOX_LEASE_SECONDS),
  queueName: environment.OUTBOX_QUEUE_NAME,
});
const listingExpiryDispatcher = new ListingExpiryDispatcher({
  repository: listingRepository,
  observability: runtimeState.observability,
  configuration: {
    batchSize: environment.LISTING_EXPIRY_BATCH_SIZE,
    pollIntervalMilliseconds: environment.LISTING_EXPIRY_POLL_INTERVAL_MS,
  },
});
const listingNotification = new ListingNotificationHandler(notificationRepository, (outcome) =>
  runtimeState.observability?.metrics.notificationEvent(outcome),
);
const organizationInvitationNotification = new OrganizationInvitationNotificationHandler(
  notificationRepository,
  (outcome) => runtimeState.observability?.metrics.notificationEvent(outcome),
);
const listingIndexHandler = new ListingIndexHandler(
  listingSearchRepository,
  listingIndex,
  (observation) => runtimeState.observability?.metrics.searchIndex(observation),
);
const listingIndexReconciler = new ListingIndexReconciler({
  repository: listingSearchRepository,
  index: listingIndex,
  handler: listingIndexHandler,
  observability: runtimeState.observability,
  configuration: {
    batchSize: environment.SEARCH_RECONCILIATION_BATCH_SIZE,
    intervalMilliseconds: environment.SEARCH_RECONCILIATION_INTERVAL_MS,
  },
});
const homepageCacheInvalidation = new HomepageCacheInvalidationHandler(
  new RedisHomepageCacheInvalidator(connection),
  (outcome) => runtimeState.observability?.metrics.homepageCacheInvalidation(outcome),
);

function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  runtimeState.observability?.logger.info(event, fields);
}

type JobHandler = (job: Job) => Promise<void>;
const handlers: Record<string, JobHandler[]> = {};

function registerHandler(eventType: string, handler: JobHandler): void {
  handlers[eventType] = [...(handlers[eventType] ?? []), handler];
}

registerHandler("search.index", () => Promise.resolve());
registerHandler("media.upload.completed", async (job) => {
  try {
    await mediaProcessing.handle(job.data);
  } catch (error: unknown) {
    if (error instanceof PermanentMediaProcessingError) {
      throw new UnrecoverableError(error.code);
    }
    throw error;
  }
});
registerHandler("notification.dispatch", () => Promise.resolve());
registerHandler("organization.invitation.accepted", () => Promise.resolve());
registerHandler("organization.invitation.revoked", () => Promise.resolve());
registerHandler("organization.member.role.changed", () => Promise.resolve());
registerHandler("organization.membership.removed", () => Promise.resolve());
registerHandler("organization.owner.transferred", () => Promise.resolve());
registerHandler(homepageLayoutPublishedEventType, async (job) => {
  try {
    await homepageCacheInvalidation.handle(job.data);
  } catch (error: unknown) {
    if (error instanceof PermanentHomepageCacheInvalidationError) {
      throw new UnrecoverableError(error.code);
    }
    throw error;
  }
});
for (const eventType of listingSearchEventTypes) {
  registerHandler(eventType, async (job) => {
    try {
      await listingIndexHandler.handle(job.data, eventType);
    } catch (error: unknown) {
      if (
        error instanceof PermanentListingSearchEventError ||
        error instanceof ListingSearchProjectionError
      ) {
        throw new UnrecoverableError(error.code);
      }
      throw error;
    }
  });
}
for (const eventType of listingNotificationEventTypes) {
  registerHandler(eventType, async (job) => {
    try {
      await listingNotification.handle(job.data, eventType);
    } catch (error: unknown) {
      if (error instanceof PermanentListingNotificationError) {
        throw new UnrecoverableError(error.code);
      }
      throw error;
    }
  });
}
for (const eventType of organizationInvitationNotificationEventTypes) {
  registerHandler(eventType, async (job) => {
    try {
      await organizationInvitationNotification.handle(job.data);
    } catch (error: unknown) {
      if (error instanceof PermanentOrganizationInvitationNotificationError) {
        throw new UnrecoverableError(error.code);
      }
      throw error;
    }
  });
}

const worker = new Worker(
  environment.OUTBOX_QUEUE_NAME,
  async (job) => {
    const jobHandlers = handlers[job.name];
    if (!jobHandlers || jobHandlers.length === 0) {
      throw new Error(`No handler registered for job ${job.name}`);
    }
    if (!runtimeState.observability) throw new Error("Observability runtime is unavailable");
    await runObservedJob(
      job,
      async () => {
        for (const handler of jobHandlers) await handler(job);
      },
      runtimeState.observability,
    );
  },
  { connection, concurrency: environment.WORKER_CONCURRENCY },
);

worker.on("error", () =>
  runtimeState.observability?.logger.error("worker.queue.error", { errorCode: "QUEUE_ERROR" }),
);
const deadLetterWrites = new Set<Promise<void>>();
worker.on("failed", (job, error) => {
  if (!job) return;
  const write = recordTerminalJobFailure({
    repository: queueOperationsRepository,
    queueName: environment.OUTBOX_QUEUE_NAME,
    job,
    error,
  })
    .then((outcome) => {
      if (outcome !== "recorded") return;
      runtimeState.observability?.metrics.queueAdminOperation("DEAD_LETTER", "recorded");
      runtimeState.observability?.logger.warn("worker.queue.dead_letter_recorded", {
        jobId: job.id,
        jobName: job.name,
        attempt: job.attemptsMade,
        errorCode: "JOB_TERMINAL_FAILURE",
      });
    })
    .catch(() => {
      runtimeState.observability?.logger.error("worker.queue.dead_letter_record_failed", {
        jobId: job.id,
        jobName: job.name,
        errorCode: "DEAD_LETTER_RECORD_FAILED",
      });
    });
  deadLetterWrites.add(write);
  void write.finally(() => deadLetterWrites.delete(write));
});

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
  await listingExpiryDispatcher.stop();
  await listingIndexReconciler.stop();
  await queueOperationsDispatcher.stop();
  await outboxDispatcher.stop();
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
  await worker.close();
  await Promise.allSettled(deadLetterWrites);
  await outboxQueue.close();
  mediaStorage.close();
  await mediaRepository.close();
  await listingRepository.close();
  await listingSearchRepository.close();
  await notificationRepository.close();
  await outboxRepository.close();
  await queueOperationsRepository.close();
  await openSearchClient.close();
  await connection.quit();
  await shutdownTracing();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

outboxDispatcher.start();
queueOperationsDispatcher.start();
listingExpiryDispatcher.start();
listingIndexReconciler.start();
logEvent("worker.started", {
  concurrency: environment.WORKER_CONCURRENCY,
  healthPort: environment.WORKER_HEALTH_PORT,
  outboxBatchSize: environment.OUTBOX_BATCH_SIZE,
  listingExpiryBatchSize: environment.LISTING_EXPIRY_BATCH_SIZE,
  searchReconciliationBatchSize: environment.SEARCH_RECONCILIATION_BATCH_SIZE,
  queue: environment.OUTBOX_QUEUE_NAME,
  ...runtimeConfigSummary(environment),
});
