import "reflect-metadata";
import IORedis from "ioredis";
import { parseApiEnvironment, RuntimeConfigError, runtimeConfigSummary } from "@socal/config";
import { shutdownTracing, type ObservabilityRuntime } from "@socal/observability";
import { createApiApplication, createApiObservability } from "./create-api-application";
import { RedisHomepageCache } from "./modules/homepage/homepage-cache";

let observability: ObservabilityRuntime | undefined;
let cacheConnection: IORedis | undefined;

async function bootstrap(): Promise<void> {
  const environment = parseApiEnvironment(process.env);
  observability = createApiObservability(environment);
  const connection = new IORedis(environment.REDIS_URL, {
    connectTimeout: 1_000,
    commandTimeout: 500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: (attempt) => Math.min(attempt * 1_000, 30_000),
  });
  cacheConnection = connection;
  connection.on("error", () => undefined);
  const homepageCache = new RedisHomepageCache({
    get: (key) => connection.get(key),
    setExpiring: async (key, value, ttlSeconds) => {
      const result = await connection.set(key, value, "EX", ttlSeconds);
      if (result !== "OK") throw new Error("Homepage cache write failed");
    },
    delete: async (key) => {
      await connection.del(key);
    },
  });
  const app = await createApiApplication(environment, { observability, homepageCache });

  await app.listen(environment.PORT, "0.0.0.0");
  observability.logger.info("api.started", {
    port: environment.PORT,
    ...runtimeConfigSummary(environment),
  });

  const shutdown = async (signal: string): Promise<void> => {
    observability?.logger.info("api.shutdown.started", { signal });
    await app.close();
    cacheConnection?.disconnect(false);
    await shutdownTracing();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap().catch((error: unknown) => {
  cacheConnection?.disconnect(false);
  const configurationError = error instanceof RuntimeConfigError;
  const fields = {
    errorCode: configurationError ? error.code : "STARTUP_FAILED",
    errorType: error instanceof Error ? error.name : "UnknownError",
  };
  if (observability) {
    observability.logger.fatal("api.startup.failed", fields);
  } else {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "fatal",
        event: "api.startup.failed",
        service: "socal-api",
        environment: process.env.APP_ENV ?? "unknown",
        version: process.env.OTEL_SERVICE_VERSION ?? "unknown",
        ...fields,
      }),
    );
  }
  process.exitCode = 1;
});
