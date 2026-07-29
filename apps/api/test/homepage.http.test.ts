import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { HomepageLayoutDefinition, HomepageResponse, ProblemDetails } from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import type { HomepageDataSource } from "../src/modules/homepage/homepage-data.source";
import type {
  HomepageLayoutLifecycleRecord,
  HomepageLayoutMutationResult,
  HomepageLayoutStore,
  HomepageLayoutVersionRecord,
} from "../src/modules/homepage-layout/homepage-layout.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-homepage-http-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "homepage-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "homepage-http-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "homepage-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "homepage-http-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "homepage-http-csrf-secret-with-more-than-32-bytes",
});

const definition: HomepageLayoutDefinition = {
  version: 1,
  locale: "en-US",
  regionCode: "US-CA-SOCAL",
  slots: [
    {
      key: "hero",
      kind: "HERO",
      enabled: true,
      source: { contentKey: "homepage.hero" },
      limit: 1,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 300,
    },
    {
      key: "cities",
      kind: "CITY_CHIPS",
      enabled: true,
      source: { regionType: "CITY" },
      limit: 8,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 3600,
    },
  ],
};

function layoutRecord(): HomepageLayoutVersionRecord {
  const timestamp = new Date("2026-07-29T12:00:00.000Z");
  return {
    id: "75000000-0000-4000-8000-000000000002",
    layoutId: "75000000-0000-4000-8000-000000000001",
    version: 1,
    revision: 1,
    definition,
    contentHash: "a".repeat(64),
    basedOnVersion: null,
    createdById: "75000000-0000-4000-8000-000000000003",
    updatedById: "75000000-0000-4000-8000-000000000003",
    publishedById: "75000000-0000-4000-8000-000000000003",
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

class MemoryHomepageLayoutStore implements HomepageLayoutStore {
  available = true;

  getPublished(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutVersionRecord | null> {
    return Promise.resolve(
      this.available &&
        input.locale === definition.locale &&
        input.regionCode === definition.regionCode &&
        (input.version === undefined || input.version === definition.version)
        ? layoutRecord()
        : null,
    );
  }

  getLifecycle(): Promise<HomepageLayoutLifecycleRecord | null> {
    return Promise.resolve(null);
  }

  saveDraft(): Promise<HomepageLayoutMutationResult> {
    return Promise.resolve({ kind: "scope_not_found" });
  }

  publishDraft(): Promise<HomepageLayoutMutationResult> {
    return Promise.resolve({ kind: "scope_not_found" });
  }

  rollback(): Promise<HomepageLayoutMutationResult> {
    return Promise.resolve({ kind: "scope_not_found" });
  }
}

const homepageDataSource: HomepageDataSource = {
  listTrending: () => Promise.resolve([]),
  listCities: () =>
    Promise.resolve([
      {
        id: "76000000-0000-4000-8000-000000000001",
        code: "US-CA-IRVINE",
        slug: "irvine",
        type: "CITY",
        name: "Irvine",
      },
    ]),
  listListings: () => Promise.resolve([]),
};

describe("public homepage HTTP API", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const layoutStore = new MemoryHomepageLayoutStore();

  beforeAll(async () => {
    app = await createApiApplication(environment, {
      logger: false,
      homepageLayoutStore: layoutStore,
      homepageDataSource,
      observability: createObservabilityRuntime({
        serviceName: "socal-homepage-http-test",
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

  it("returns strict published modules and no shared cache", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/homepage?locale=en-US&regionCode=US-CA-SOCAL&device=mobile",
    });
    const body = response.json<HomepageResponse>();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(body.layout).toEqual({
      version: 1,
      locale: "en-US",
      regionCode: "US-CA-SOCAL",
      device: "mobile",
    });
    expect(body.modules.map((module) => module.kind)).toEqual(["HERO", "CITY_CHIPS"]);
    expect(JSON.stringify(body)).not.toContain("phone");
    expect(JSON.stringify(body)).not.toContain("sourceCount");
  });

  it("rejects unknown query fields without reflection", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/homepage?locale=en-US&preview=private%40example.com",
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).not.toContain("private@example.com");
  });

  it("maps a missing published scope to service unavailable", async () => {
    layoutStore.available = false;
    const response = await server.inject({
      method: "GET",
      url: "/v1/homepage?locale=en-US",
    });
    const body = response.json<ProblemDetails>();
    expect(response.statusCode).toBe(503);
    expect(body.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    layoutStore.available = true;
  });
});
