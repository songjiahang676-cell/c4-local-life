import { StructuredLogger, type LogLevel, type LogSink } from "./logger";
import { MetricsRegistry } from "./metrics";
import { initializeTracing } from "./tracing";

export type ObservabilityRuntimeConfiguration = {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  minimumLogLevel?: LogLevel;
  otlpEndpoint?: string;
  logSink?: LogSink;
};

export type ObservabilityRuntime = {
  logger: StructuredLogger;
  metrics: MetricsRegistry;
};

export function createObservabilityRuntime(
  configuration: ObservabilityRuntimeConfiguration,
): ObservabilityRuntime {
  initializeTracing({
    serviceName: configuration.serviceName,
    serviceVersion: configuration.serviceVersion,
    environment: configuration.environment,
    otlpEndpoint: configuration.otlpEndpoint,
  });

  return {
    logger: new StructuredLogger({
      service: configuration.serviceName,
      version: configuration.serviceVersion,
      environment: configuration.environment,
      minimumLevel: configuration.minimumLogLevel,
      sink: configuration.logSink,
    }),
    metrics: new MetricsRegistry(),
  };
}
