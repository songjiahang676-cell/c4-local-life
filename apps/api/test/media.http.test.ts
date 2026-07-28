import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { CreateUploadResponse } from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { CapturingMediaObjectStorage, MemoryMediaStore } from "./support/memory-media.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-media-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "media-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "media-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "media-mfa-secret-with-more-than-32-bytes",
  CSRF_SECRET: "media-csrf-secret-with-more-than-32-bytes",
  S3_QUARANTINE_BUCKET: "socal-test-quarantine",
});

const activeUserId = "10000000-0000-4000-8000-000000000051";
const limitedUserId = "10000000-0000-4000-8000-000000000052";
const validPayload = {
  filename: "客厅照片.webp",
  mimeType: "image/webp",
  byteSize: 4_096,
  sha256: "a".repeat(64),
  purpose: "LISTING_MEDIA",
} as const;

describe("media upload HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let store: MemoryMediaStore;
  let storage: CapturingMediaObjectStorage;
  let activeCookie: string;
  let limitedCookie: string;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    authStore.registerSubject(buildActiveSubject({ id: activeUserId }));
    authStore.registerSubject(buildActiveSubject({ id: limitedUserId, status: "LIMITED" }));
    store = new MemoryMediaStore();
    storage = new CapturingMediaObjectStorage();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mediaStore: store,
      mediaObjectStorage: storage,
      observability: createObservabilityRuntime({
        serviceName: "socal-api-media-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    const active = await sessions.issueSession(activeUserId, {});
    const limited = await sessions.issueSession(limitedUserId, {});
    activeCookie = `${environment.SESSION_COOKIE_NAME}=${active.token}`;
    limitedCookie = `${environment.SESSION_COOKIE_NAME}=${limited.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("reserves private quarantine and returns checksum-bound short-lived upload headers", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        cookie: activeCookie,
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "media-upload-http-0001",
      },
      payload: validPayload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<CreateUploadResponse>();
    expect(body.data.method).toBe("PUT");
    expect(body.data.uploadUrl).toMatch(
      /^https:\/\/quarantine\.example\.invalid\/quarantine\/[0-9a-f]{2}\/[0-9a-f-]{36}\/original\?signed=test$/,
    );
    expect(body.data.headers).toMatchObject({
      "content-length": "4096",
      "content-type": "image/webp",
      "x-amz-meta-content-sha256": validPayload.sha256,
      "x-amz-server-side-encryption": "AES256",
    });
    const expiryMs = Date.parse(body.data.expiresAt) - store.inputs[0]!.now.getTime();
    expect(expiryMs).toBe(300_000);
    expect(store.inputs[0]).toMatchObject({
      ownerId: activeUserId,
      bucket: "socal-test-quarantine",
      mimeType: "image/webp",
      maximumActive: 20,
      dailyByteLimit: 209_715_200,
    });
    expect(store.inputs[0]!.objectKey).not.toContain(validPayload.filename);
    expect(storage.inputs[0]).toMatchObject({
      bucket: "socal-test-quarantine",
      objectKey: store.inputs[0]!.objectKey,
      sha256Hex: validPayload.sha256,
    });
  });

  it("replays the same reservation and rejects a changed idempotency payload", async () => {
    const headers = {
      cookie: activeCookie,
      origin: environment.PUBLIC_WEB_URL,
      "idempotency-key": "media-upload-http-0002",
    };
    const first = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers,
      payload: validPayload,
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers,
      payload: validPayload,
    });
    const conflict = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers,
      payload: { ...validPayload, byteSize: validPayload.byteSize + 1 },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      detail: "Idempotency-Key was already used with a different upload declaration",
    });
  });

  it("fails closed for guests, limited accounts and cross-site cookie writes", async () => {
    const base = {
      method: "POST" as const,
      url: "/v1/media/uploads",
      headers: { "idempotency-key": "media-upload-http-0003" },
      payload: validPayload,
    };
    const guest = await server.inject(base);
    const limited = await server.inject({
      ...base,
      headers: {
        ...base.headers,
        cookie: limitedCookie,
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const crossSite = await server.inject({
      ...base,
      headers: {
        ...base.headers,
        cookie: activeCookie,
        origin: "https://evil.example.invalid",
      },
    });

    expect(guest.statusCode).toBe(401);
    expect(limited.statusCode).toBe(403);
    expect(crossSite.statusCode).toBe(403);
  });

  it("rejects unsafe declarations before reserving storage", async () => {
    const headers = {
      cookie: activeCookie,
      origin: environment.PUBLIC_WEB_URL,
      "idempotency-key": "media-upload-http-0004",
    };
    const invalidHash = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers,
      payload: { ...validPayload, sha256: "A".repeat(64) },
    });
    const unknownField = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers,
      payload: { ...validPayload, bucket: "public-assets" },
    });
    const oversizedAvatar = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: { ...headers, "idempotency-key": "media-upload-http-0005" },
      payload: { ...validPayload, purpose: "AVATAR", byteSize: 8_388_609 },
    });
    const verification = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: { ...headers, "idempotency-key": "media-upload-http-0006" },
      payload: {
        ...validPayload,
        purpose: "VERIFICATION",
        mimeType: "application/pdf",
      },
    });
    const duplicateIdempotencyKey = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        ...headers,
        "idempotency-key": "media-upload-http-0004,media-upload-http-duplicate",
      },
      payload: validPayload,
    });

    expect(invalidHash.statusCode).toBe(400);
    expect(unknownField.statusCode).toBe(400);
    expect(oversizedAvatar.statusCode).toBe(413);
    expect(verification.statusCode).toBe(422);
    expect(duplicateIdempotencyKey.statusCode).toBe(400);
  });

  it("returns Retry-After for quota exhaustion and hides storage-provider failures", async () => {
    store.nextResult = {
      kind: "active_quota_exceeded",
      retryAfter: new Date(Date.now() + 30_000),
    };
    const quota = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        cookie: activeCookie,
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "media-upload-http-0007",
      },
      payload: validPayload,
    });
    storage.failure = new Error("provider-secret-value");
    const unavailable = await server.inject({
      method: "POST",
      url: "/v1/media/uploads",
      headers: {
        cookie: activeCookie,
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "media-upload-http-0008",
      },
      payload: validPayload,
    });

    expect(quota.statusCode).toBe(429);
    expect(Number(quota.headers["retry-after"])).toBeGreaterThan(0);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("provider-secret-value");
    storage.failure = null;
  });
});
