import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { ProblemDetails } from "@socal/contracts";
import { createObservabilityRuntime, type ObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "test-otp-secret-with-more-than-32-bytes",
  CSRF_SECRET: "test-csrf-secret-with-more-than-32-bytes",
  API_BODY_LIMIT_BYTES: "1024",
});

const validListing = {
  type: "RENTAL",
  categoryId: "11111111-1111-4111-8111-111111111111",
  title: "Fictional Irvine rental",
  body: "A deliberately fictional listing body for API foundation tests.",
  regionCode: "US-CA-ORANGE-IRVINE",
};

describe("HTTP foundation", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let observability: ObservabilityRuntime;
  let mutationHeaders: { cookie: string; origin: string };
  let limitedMutationHeaders: { cookie: string; origin: string };
  const logRecords: string[] = [];

  beforeAll(async () => {
    const userId = "10000000-0000-4000-8000-000000000001";
    const limitedUserId = "10000000-0000-4000-8000-000000000002";
    const authSessionStore = new MemoryAuthSessionStore();
    authSessionStore.registerSubject(buildActiveSubject({ id: userId }));
    authSessionStore.registerSubject(buildActiveSubject({ id: limitedUserId, status: "LIMITED" }));
    observability = createObservabilityRuntime({
      serviceName: "socal-api-test",
      serviceVersion: "0.1.0",
      environment: "test",
      logSink: (record) => logRecords.push(record),
    });
    app = await createApiApplication(environment, {
      logger: false,
      observability,
      authSessionStore,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const issued = await app.get(AuthSessionService).issueSession(userId, {});
    mutationHeaders = {
      cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}`,
      origin: environment.PUBLIC_WEB_URL,
    };
    const limited = await app.get(AuthSessionService).issueSession(limitedUserId, {});
    limitedMutationHeaders = {
      cookie: `${environment.SESSION_COOKIE_NAME}=${limited.token}`,
      origin: environment.PUBLIC_WEB_URL,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts a safe request ID and exposes it on the response", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/health/live",
      headers: { "x-request-id": "api-foundation-test-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("api-foundation-test-1");
    expect(response.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    expect(logRecords.at(-1)).toContain('"event":"http.request.completed"');
    expect(logRecords.at(-1)).toContain('"requestId":"api-foundation-test-1"');
  });

  it("serves low-cardinality Prometheus RED metrics without caching", async () => {
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("socal_http_requests_total");
    expect(response.body).toContain('route="/v1/health/live"');
  });

  it("replaces an unsafe request ID", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/health/live",
      headers: { "x-request-id": "bad request id" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).not.toBe("bad request id");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns field-addressable RFC 9457 validation errors", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders,
      payload: {
        ...validListing,
        title: "no",
        body: "short",
        regionCode: "x",
        unexpected: "rejected",
      },
    });
    const problem = response.json<ProblemDetails>();

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(problem).toMatchObject({
      type: "https://api.socal.local/problems/validation",
      title: "Bad Request",
      status: 400,
      detail: "Request validation failed",
      instance: "/v1/listings",
    });
    expect(Object.keys(problem.errors ?? {})).toEqual(
      expect.arrayContaining(["unexpected", "title", "body", "regionCode"]),
    );
    expect(problem).not.toHaveProperty("stack");
  });

  it("rejects unknown query parameters", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/listings?unapprovedSort=internal_score",
    });

    const problem = response.json<ProblemDetails>();
    expect(response.statusCode).toBe(400);
    expect(problem.status).toBe(400);
    expect(Array.isArray(problem.errors?.unapprovedSort)).toBe(true);
  });

  it("enforces the configured JSON body limit", async () => {
    expect(server.initialConfig.bodyLimit).toBe(1_024);
    const response = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: { ...mutationHeaders, "content-type": "application/json" },
      payload: JSON.stringify({ ...validListing, body: "x".repeat(2_000) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json<ProblemDetails>()).toMatchObject({
      title: "Payload Too Large",
      status: 413,
      instance: "/v1/listings",
    });
  });

  it("allows only configured credentialed CORS origins", async () => {
    const allowed = await server.inject({
      method: "GET",
      url: "/v1/health/live",
      headers: { origin: environment.PUBLIC_WEB_URL },
    });
    const foreign = await server.inject({
      method: "GET",
      url: "/v1/health/live",
      headers: { origin: "https://foreign.example.invalid" },
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe(environment.PUBLIC_WEB_URL);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(foreign.headers).not.toHaveProperty("access-control-allow-origin");
  });

  it("blocks cross-site cookie-authenticated mutations", async () => {
    const blocked = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        cookie: mutationHeaders.cookie,
        origin: "https://foreign.example.invalid",
      },
      payload: validListing,
    });
    const allowed = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders,
      payload: validListing,
    });

    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<ProblemDetails>()).toMatchObject({
      title: "Forbidden",
      status: 403,
      detail: "Cross-site request rejected",
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("fails closed for unauthenticated and limited listing mutations", async () => {
    const unauthenticated = await server.inject({
      method: "POST",
      url: "/v1/listings",
      payload: validListing,
    });
    const limited = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: limitedMutationHeaders,
      payload: validListing,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json<ProblemDetails>()).toMatchObject({
      title: "Unauthorized",
      detail: "Authentication required",
    });
    expect(limited.statusCode).toBe(403);
    expect(limited.json<ProblemDetails>()).toMatchObject({
      title: "Forbidden",
      detail: "Access denied",
    });
    expect(limited.body).not.toContain("ACCOUNT_RESTRICTED");
  });

  it("uses Problem Details for routing errors without query reflection", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/not-a-route?sensitive=not-reflected",
    });
    const problem = response.json<ProblemDetails>();

    expect(response.statusCode).toBe(404);
    expect(problem).toMatchObject({
      title: "Not Found",
      status: 404,
      instance: "/v1/not-a-route",
    });
    expect(typeof problem.requestId).toBe("string");
    expect(JSON.stringify(problem)).not.toContain("not-reflected");
  });
});
