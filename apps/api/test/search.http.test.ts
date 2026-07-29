import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { ProblemDetails, SearchResponse } from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import {
  SearchSnapshotExpiredError,
  SearchTimeoutError,
  SearchUnavailableError,
} from "../src/modules/search/search.store";
import {
  MemorySearchStore,
  searchStoreResult,
  syntheticSearchResult,
} from "./support/memory-search.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-search-http-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "search-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "search-http-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "search-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "search-http-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "search-http-csrf-secret-with-more-than-32-bytes",
});

describe("public search HTTP API", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let store: MemorySearchStore;

  beforeAll(async () => {
    store = new MemorySearchStore();
    app = await createApiApplication(environment, {
      logger: false,
      searchStore: store,
      observability: createObservabilityRuntime({
        serviceName: "socal-search-http-test",
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

  it("returns a minimal public result, fixed facets, and no-store caching", async () => {
    store.results.push(
      searchStoreResult(
        [
          {
            result: syntheticSearchResult(),
            sort: [1, "2026-07-28T12:00:00.000Z", "81000000-0000-4000-8000-000000000001"],
          },
        ],
        {
          facets: {
            types: [{ value: "RENTAL", count: 1 }],
            categories: [{ value: "83000000-0000-4000-8000-000000000001", count: 1 }],
            regions: [{ value: "US-CA-ORANGE-IRVINE", count: 1 }],
            priceUnits: [{ value: "MONTHLY", count: 1 }],
          },
        },
      ),
    );
    const response = await server.inject({
      method: "GET",
      url: "/v1/search?q=%EF%BC%A9%EF%BD%92%EF%BD%96%EF%BD%89%EF%BD%8E%EF%BD%85&limit=20",
    });
    const payload = response.json<SearchResponse>();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(payload).toMatchObject({
      data: [{ title: "Synthetic Irvine rental", status: "PUBLISHED" }],
      page: { nextCursor: null, hasMore: false },
      facets: { types: [{ value: "RENTAL", count: 1 }] },
      correctedQuery: null,
    });
    expect(store.searched.at(-1)?.criteria.q).toBe("Irvine");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("moderationStatus");
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain("qualityScore");
    expect(serialized).not.toContain("promotion");
    expect(serialized).not.toContain("phone");
  });

  it("rejects ambiguous geo, unsafe text, unknown keys, and reversed prices without reflection", async () => {
    for (const url of [
      "/v1/search?sort=DISTANCE",
      "/v1/search?latitude=33.68",
      "/v1/search?radiusMiles=25",
      "/v1/search?minPrice=10.01&maxPrice=10.00",
      "/v1/search?unknown=true",
      `/v1/search?q=${encodeURIComponent("private\u202equery")}`,
    ]) {
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(400);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.body).not.toContain("private");
    }
  });

  it("maps expired snapshots, bounded timeouts, and dependency failures to explicit problems", async () => {
    for (const [error, expectedStatus, expectedTitle] of [
      [new SearchSnapshotExpiredError(), 410, "Gone"],
      [new SearchTimeoutError(), 504, "Gateway Timeout"],
      [new SearchUnavailableError(), 503, "Service Unavailable"],
    ] as const) {
      store.errors.push(error);
      const response = await server.inject({ method: "GET", url: "/v1/search?sort=NEWEST" });
      expect(response.statusCode).toBe(expectedStatus);
      expect(response.json<ProblemDetails>()).toMatchObject({
        status: expectedStatus,
        title: expectedTitle,
        instance: "/v1/search",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("exports bounded search metrics without query, cursor, or identifiers as labels", async () => {
    store.results.push(searchStoreResult());
    await server.inject({ method: "GET", url: "/v1/search?q=private-query&sort=NEWEST" });
    const response = await server.inject({ method: "GET", url: "/metrics" });

    expect(response.body).toContain(
      'socal_search_queries_total{outcome="empty",sort="NEWEST",geo="false"} 1',
    );
    expect(response.body).not.toContain("private-query");
    expect(response.body).not.toContain("memory-pit");
  });
});
