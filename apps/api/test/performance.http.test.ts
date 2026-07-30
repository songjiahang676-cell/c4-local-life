import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { ProblemDetails, WebVitalAcceptedResponse } from "@socal/contracts";
import { createObservabilityRuntime, MetricsRegistry } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { PerformanceService } from "../src/modules/performance/performance.service";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-performance-http-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "performance-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "performance-http-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "performance-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "performance-http-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "performance-http-csrf-secret-with-more-than-32-bytes",
});

describe("bounded first-party performance telemetry", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      logger: false,
      observability: createObservabilityRuntime({
        serviceName: "socal-performance-http-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts only fixed metric and route dimensions with no-store", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/performance/web-vitals",
      payload: { name: "LCP", value: 2_450, route: "homepage" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<WebVitalAcceptedResponse>()).toEqual({ accepted: true });

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    expect(metrics.body).toContain(
      'socal_web_vital_duration_seconds_bucket{metric="LCP",route="homepage",le="2.5"} 1',
    );
  });

  it("rejects identifiers, raw routes and out-of-range CLS without reflecting them", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/performance/web-vitals",
      payload: {
        name: "CLS",
        value: 11,
        route: "homepage",
        url: "/zh-Hans/search?q=private-person@example.com",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ProblemDetails>().errors).toMatchObject({
      url: ["Unknown field"],
    });
    expect(response.body).not.toContain("private-person@example.com");
  });

  it("bounds transient per-client aggregation without retaining or exporting the address", () => {
    const metrics = new MetricsRegistry();
    const performance = new PerformanceService(metrics);
    for (let index = 0; index < 120; index += 1) {
      expect(
        performance.record(
          { name: "INP", value: 150, route: "listing-detail" },
          "203.0.113.42",
          1_000,
        ),
      ).toBe(true);
    }
    expect(
      performance.record(
        { name: "INP", value: 150, route: "listing-detail" },
        "203.0.113.42",
        1_000,
      ),
    ).toBe(false);
    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain(
      'socal_web_vital_duration_seconds_count{metric="INP",route="listing-detail"} 120',
    );
    expect(rendered).not.toContain("203.0.113.42");
  });
});
