import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanContext,
  type TextMapGetter,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export type TracingConfiguration = {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint?: string;
};

type TraceCarrier = Record<string, string | string[] | undefined>;

const headerGetter: TextMapGetter<TraceCarrier> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => carrier[key.toLowerCase()],
};

let provider: NodeTracerProvider | undefined;
let activeConfiguration: TracingConfiguration | undefined;

function traceExportUrl(endpoint: string): string {
  return new URL("v1/traces", endpoint.endsWith("/") ? endpoint : `${endpoint}/`).toString();
}

export function initializeTracing(configuration: TracingConfiguration): void {
  if (provider) return;

  const spanProcessors = configuration.otlpEndpoint
    ? [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: traceExportUrl(configuration.otlpEndpoint) }),
        ),
      ]
    : [];
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": configuration.serviceName,
      "service.version": configuration.serviceVersion,
      "deployment.environment.name": configuration.environment,
    }),
    spanProcessors,
  });
  provider.register();
  activeConfiguration = configuration;
}

export async function shutdownTracing(): Promise<void> {
  await provider?.shutdown();
}

function tracer() {
  return trace.getTracer(
    activeConfiguration?.serviceName ?? "socal-life-platform",
    activeConfiguration?.serviceVersion,
  );
}

export function startServerSpan(name: string, carrier: TraceCarrier, attributes: Attributes): Span {
  const parentContext = propagation.extract(context.active(), carrier, headerGetter);
  return tracer().startSpan(name, { kind: SpanKind.SERVER, attributes }, parentContext);
}

export function startConsumerSpan(
  name: string,
  carrier: TraceCarrier,
  attributes: Attributes,
): Span {
  const parentContext = propagation.extract(context.active(), carrier, headerGetter);
  return tracer().startSpan(name, { kind: SpanKind.CONSUMER, attributes }, parentContext);
}

export function runInSpanContext<T>(span: Span, callback: () => T): T {
  const spanContext: Context = trace.setSpan(context.active(), span);
  return context.with(spanContext, callback);
}

export function finishSpan(span: Span, outcome: "ok" | "error", errorType?: string): void {
  if (outcome === "error") {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (errorType) span.setAttribute("error.type", errorType);
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

export function traceFields(span: Span): {
  traceId: string;
  spanId: string;
  traceparent: string;
} {
  const spanContext: SpanContext = span.spanContext();
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`,
  };
}
