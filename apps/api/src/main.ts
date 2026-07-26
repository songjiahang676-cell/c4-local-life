import "reflect-metadata";
import { parseApiEnvironment, RuntimeConfigError, runtimeConfigSummary } from "@socal/config";
import { shutdownTracing, type ObservabilityRuntime } from "@socal/observability";
import { createApiApplication, createApiObservability } from "./create-api-application";

let observability: ObservabilityRuntime | undefined;

async function bootstrap(): Promise<void> {
  const environment = parseApiEnvironment(process.env);
  observability = createApiObservability(environment);
  const app = await createApiApplication(environment, { observability });

  await app.listen(environment.PORT, "0.0.0.0");
  observability.logger.info("api.started", {
    port: environment.PORT,
    ...runtimeConfigSummary(environment),
  });

  const shutdown = async (signal: string): Promise<void> => {
    observability?.logger.info("api.shutdown.started", { signal });
    await app.close();
    await shutdownTracing();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void bootstrap().catch((error: unknown) => {
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
