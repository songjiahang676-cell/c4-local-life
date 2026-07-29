import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { LoggerService, NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { SwaggerModule } from "@nestjs/swagger";
import type { ApiEnvironment } from "@socal/config";
import {
  createObservabilityRuntime,
  finishSpan,
  runInSpanContext,
  runWithObservabilityContext,
  startServerSpan,
  traceFields,
  type ObservabilityRuntime,
  type StructuredLogger,
} from "@socal/observability";
import { LogController, type FastifyInstance, type FastifyRequest } from "fastify";
import { AppModule } from "./app.module";
import { loadCanonicalOpenApiDocument } from "./common/openapi-document";
import { ProblemDetailsFilter } from "./common/problem-details.filter";
import type { AuthSessionStore } from "./modules/auth/auth-session.store";
import type { MfaStore } from "./modules/admin/mfa.store";
import type { ModerationStore } from "./modules/admin/moderation.store";
import type { OtpChallengeStore } from "./modules/auth/otp-challenge.store";
import type { OtpDeliveryGateway } from "./modules/auth/otp-delivery.gateway";
import type { PasswordNotificationGateway } from "./modules/auth/password-notification.gateway";
import type { PasswordStore } from "./modules/auth/password.store";
import type { OrganizationStore } from "./modules/organizations/organization.store";
import type { ListingStore } from "./modules/listings/listing.store";
import type { MediaObjectStorage } from "./modules/media/media-object-storage";
import type { MediaStore } from "./modules/media/media.store";
import type { NotificationStore } from "./modules/notifications/notification.store";
import type { TaxonomyStore } from "./modules/taxonomy/taxonomy.store";
import type { TrustSafetyStore } from "./modules/trust-safety/trust-safety.store";

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const trustedProxyNetworks = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
] as const;

type RequestObservabilityState = {
  startedAt: bigint;
  span: ReturnType<typeof startServerSpan>;
  traceId: string;
  spanId: string;
  traceparent: string;
};

export type CreateApiApplicationOptions = Pick<NestApplicationOptions, "logger"> & {
  observability?: ObservabilityRuntime;
  authSessionStore?: AuthSessionStore;
  otpChallengeStore?: OtpChallengeStore;
  otpDeliveryGateway?: OtpDeliveryGateway;
  organizationStore?: OrganizationStore;
  taxonomyStore?: TaxonomyStore;
  mediaStore?: MediaStore;
  mediaObjectStorage?: MediaObjectStorage;
  mfaStore?: MfaStore;
  passwordStore?: PasswordStore;
  passwordNotificationGateway?: PasswordNotificationGateway;
  listingStore?: ListingStore;
  moderationStore?: ModerationStore;
  notificationStore?: NotificationStore;
  trustSafetyStore?: TrustSafetyStore;
};

class NestStructuredLogger implements LoggerService {
  constructor(private readonly logger: StructuredLogger) {}

  log(): void {
    this.logger.info("framework.log");
  }

  error(): void {
    this.logger.error("framework.error", { errorCode: "FRAMEWORK_ERROR" });
  }

  warn(): void {
    this.logger.warn("framework.warning");
  }

  debug(): void {
    this.logger.debug("framework.debug");
  }

  verbose(): void {
    this.logger.trace("framework.verbose");
  }

  fatal(): void {
    this.logger.fatal("framework.fatal", { errorCode: "FRAMEWORK_FATAL" });
  }
}

export function requestIdFromHeaders(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"];
  if (typeof candidate === "string" && requestIdPattern.test(candidate)) return candidate;
  return randomUUID();
}

export function createApiObservability(environment: ApiEnvironment): ObservabilityRuntime {
  return createObservabilityRuntime({
    serviceName: environment.OTEL_SERVICE_NAME || "socal-api",
    serviceVersion: environment.OTEL_SERVICE_VERSION,
    environment: environment.APP_ENV,
    minimumLogLevel: environment.LOG_LEVEL,
    otlpEndpoint: environment.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
  });
}

export async function createApiApplication(
  environment: ApiEnvironment,
  options: CreateApiApplicationOptions = {},
): Promise<NestFastifyApplication> {
  const observability = options.observability ?? createApiObservability(environment);
  const adapter = new FastifyAdapter({
    trustProxy: [...trustedProxyNetworks],
    requestIdHeader: false,
    genReqId: requestIdFromHeaders,
    bodyLimit: environment.API_BODY_LIMIT_BYTES,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const fastify: FastifyInstance = adapter.getInstance();
  fastify.addContentTypeParser(
    "application/merge-patch+json",
    { parseAs: "string" },
    fastify.getDefaultJsonParser("ignore", "ignore"),
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      environment,
      options.authSessionStore,
      options.otpChallengeStore,
      options.otpDeliveryGateway,
      options.organizationStore,
      options.taxonomyStore,
      options.mediaStore,
      options.mediaObjectStorage,
      options.mfaStore,
      options.passwordStore,
      options.passwordNotificationGateway,
      options.listingStore,
      options.moderationStore,
      options.notificationStore,
      options.trustSafetyStore,
    ),
    adapter,
    {
      logger:
        options.logger === undefined
          ? new NestStructuredLogger(observability.logger)
          : options.logger,
    },
  );

  app.setGlobalPrefix("v1");
  app.enableCors({
    origin: [environment.PUBLIC_WEB_URL, environment.PUBLIC_ADMIN_URL],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "x-request-id",
      "x-device-id",
      "x-csrf-token",
      "idempotency-key",
      "if-match",
      "traceparent",
      "tracestate",
    ],
    exposedHeaders: ["x-request-id", "traceparent", "etag"],
    maxAge: 600,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const requestStates = new WeakMap<FastifyRequest, RequestObservabilityState>();
  fastify.addHook("onRequest", (request, _reply, done) => {
    observability.metrics.httpRequestStarted();
    const span = startServerSpan(`HTTP ${request.method}`, request.headers, {
      "http.request.method": request.method,
      "url.path": request.url.split("?", 1)[0] ?? "/",
    });
    const fields = traceFields(span);
    requestStates.set(request, {
      startedAt: process.hrtime.bigint(),
      span,
      ...fields,
    });
    runWithObservabilityContext(
      {
        requestId: request.id,
        traceId: fields.traceId,
        spanId: fields.spanId,
      },
      () => runInSpanContext(span, done),
    );
  });

  fastify.addHook("onSend", (request, reply, payload, done) => {
    void reply.header("x-request-id", request.id);
    if (request.url.split("?", 1)[0]?.startsWith("/v1/admin/")) {
      void reply
        .header("cache-control", "no-store")
        .header("pragma", "no-cache")
        .header("vary", "Cookie");
    }
    const state = requestStates.get(request);
    if (state) {
      const durationSeconds = Number(process.hrtime.bigint() - state.startedAt) / 1_000_000_000;
      const route = request.routeOptions.url || "unmatched";
      observability.metrics.observeHttpRequest({
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationSeconds,
      });
      observability.logger.info("http.request.completed", {
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationMs: Math.round(durationSeconds * 1_000),
        outcome: reply.statusCode >= 500 ? "error" : "completed",
        requestId: request.id,
        traceId: state.traceId,
        spanId: state.spanId,
      });
      void reply.header("traceparent", state.traceparent);
      state.span.setAttribute("http.response.status_code", reply.statusCode);
      finishSpan(state.span, reply.statusCode >= 500 ? "error" : "ok");
      requestStates.delete(request);
    }
    done(null, payload);
  });

  fastify.get("/metrics", (_request, reply) => {
    void reply
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .header("cache-control", "no-store");
    return observability.metrics.renderPrometheus();
  });

  const canonicalOpenApi = await loadCanonicalOpenApiDocument();
  fastify.get("/docs/openapi.yaml", (_request, reply) => {
    void reply
      .header("content-type", "application/yaml; charset=utf-8")
      .header("cache-control", "public, max-age=60");
    return canonicalOpenApi.source;
  });
  SwaggerModule.setup("docs", app, canonicalOpenApi.document, {
    customSiteTitle: "SoCal Life API",
    jsonDocumentUrl: "docs/openapi.json",
  });

  return app;
}
