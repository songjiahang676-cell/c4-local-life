import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { SearchIndexOperationResponse } from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";
import {
  memorySearchRebuildId,
  MemorySearchIndexOperationsStore,
} from "./support/memory-search-index-operations.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-search-rebuild-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "search-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "search-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "search-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "search-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "search-csrf-secret-with-more-than-32-bytes",
});

const adminId = "41000000-0000-4000-8000-000000000111";
const auditorId = "41000000-0000-4000-8000-000000000112";
const origin = { origin: environment.PUBLIC_ADMIN_URL };

describe("Admin search index operations HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let store: MemorySearchIndexOperationsStore;
  let adminCookie: string;
  let primaryCookie: string;
  let staleCookie: string;
  let auditorCookie: string;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    authStore.registerSubject(buildActiveSubject({ id: adminId, displayName: "Synthetic Admin" }));
    authStore.registerSubject(
      buildActiveSubject({ id: auditorId, displayName: "Synthetic Auditor" }),
    );
    authStore.registerPlatformRole(adminId, "PLATFORM_ADMIN");
    authStore.registerPlatformRole(auditorId, "READ_ONLY_AUDITOR");
    store = new MemorySearchIndexOperationsStore();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mfaStore: new MemoryMfaStore(),
      searchIndexOperationsStore: store,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    const primary = await sessions.issueSession(adminId, {});
    primaryCookie = `${environment.SESSION_COOKIE_NAME}=${primary.token}`;
    const elevationSource = await sessions.issueSession(adminId, {});
    const elevated = await sessions.elevateWithMfa(elevationSource.token, {});
    if (!elevated) throw new Error("Expected Admin MFA session");
    adminCookie = `${environment.SESSION_COOKIE_NAME}=${elevated.token}`;
    const staleAt = new Date(Date.now() - 11 * 60_000);
    const stalePrimary = await sessions.issueSession(adminId, {}, staleAt);
    const stale = await sessions.elevateWithMfa(stalePrimary.token, {}, staleAt);
    if (!stale) throw new Error("Expected stale Admin MFA session");
    staleCookie = `${environment.SESSION_COOKIE_NAME}=${stale.token}`;
    const auditorPrimary = await sessions.issueSession(auditorId, {});
    const auditor = await sessions.elevateWithMfa(auditorPrimary.token, {});
    if (!auditor) throw new Error("Expected auditor MFA session");
    auditorCookie = `${environment.SESSION_COOKIE_NAME}=${auditor.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates one idempotent rebuild without exposing cursors, hashes, or Listing data", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/admin/system/search/rebuilds",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "search-rebuild-0001",
        ...origin,
      },
      payload: {
        reasonCode: "INDEX_DRIFT_RECOVERY",
        ticketRef: "INC-2026-0050",
        rollbackWindowHours: 24,
      },
    };
    const first = await server.inject(request);
    const retry = await server.inject(request);
    expect([first.statusCode, retry.statusCode]).toEqual([202, 202]);
    expect(retry.json()).toEqual(first.json());
    const response = first.json<SearchIndexOperationResponse>();
    expect(response.data).toMatchObject({
      id: memorySearchRebuildId,
      type: "SEARCH_INDEX_REBUILD",
      phase: "PENDING",
      schemaVersion: 1,
    });
    expect(JSON.stringify(response)).not.toMatch(
      /scanCursor|Digest|requestHash|ticketRef|reasonCode/i,
    );
  });

  it("requires recent MFA Admin to mutate and permits MFA auditor read-only access", async () => {
    const mutate = (cookie: string, key: string): Promise<{ statusCode: number }> =>
      server.inject({
        method: "POST",
        url: "/v1/admin/system/search/rebuilds",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": key,
          ...origin,
        },
        payload: { reasonCode: "INDEX_DRIFT_RECOVERY" },
      });
    const [guest, primary, stale, auditor, guestRead, primaryRead, adminRead] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/admin/system/search/rebuilds",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "search-rebuild-guest",
          ...origin,
        },
        payload: { reasonCode: "INDEX_DRIFT_RECOVERY" },
      }),
      mutate(primaryCookie, "search-rebuild-0002"),
      mutate(staleCookie, "search-rebuild-0003"),
      mutate(auditorCookie, "search-rebuild-0004"),
      server.inject({
        method: "GET",
        url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}`,
      }),
      server.inject({
        method: "GET",
        url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}`,
        headers: { cookie: primaryCookie },
      }),
      server.inject({
        method: "GET",
        url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}`,
        headers: { cookie: adminCookie },
      }),
    ]);
    expect([
      guest.statusCode,
      primary.statusCode,
      stale.statusCode,
      auditor.statusCode,
      guestRead.statusCode,
      primaryRead.statusCode,
      adminRead.statusCode,
    ]).toEqual([401, 403, 403, 403, 401, 403, 200]);
    const read = await server.inject({
      method: "GET",
      url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}`,
      headers: { cookie: auditorCookie },
    });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
  });

  it("rejects missing idempotency keys and unknown or out-of-range request fields", async () => {
    const request = (
      payload: Record<string, unknown>,
      idempotencyKey?: string,
    ): Promise<{ statusCode: number }> =>
      server.inject({
        method: "POST",
        url: "/v1/admin/system/search/rebuilds",
        headers: {
          cookie: adminCookie,
          "content-type": "application/json",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...origin,
        },
        payload,
      });
    const [missingKey, unknownField, zeroWindow, excessiveWindow, unsafeReason] = await Promise.all(
      [
        request({ reasonCode: "INDEX_DRIFT_RECOVERY" }),
        request(
          { reasonCode: "INDEX_DRIFT_RECOVERY", scanCursor: memorySearchRebuildId },
          "search-rebuild-invalid-0001",
        ),
        request(
          { reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 0 },
          "search-rebuild-invalid-0002",
        ),
        request(
          { reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 169 },
          "search-rebuild-invalid-0003",
        ),
        request({ reasonCode: "operator note" }, "search-rebuild-invalid-0004"),
      ],
    );
    expect([
      missingKey.statusCode,
      unknownField.statusCode,
      zeroWindow.statusCode,
      excessiveWindow.statusCode,
      unsafeReason.statusCode,
    ]).toEqual([400, 400, 400, 400, 400]);
  });

  it("rejects changed idempotent input and concurrent rebuilds", async () => {
    const changed = await server.inject({
      method: "POST",
      url: "/v1/admin/system/search/rebuilds",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "search-rebuild-0001",
        ...origin,
      },
      payload: { reasonCode: "MANUAL_RECOVERY", rollbackWindowHours: 24 },
    });
    const concurrent = await server.inject({
      method: "POST",
      url: "/v1/admin/system/search/rebuilds",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "search-rebuild-0005",
        ...origin,
      },
      payload: { reasonCode: "INDEX_DRIFT_RECOVERY" },
    });
    expect([changed.statusCode, concurrent.statusCode]).toEqual([409, 409]);
  });

  it("creates a separately idempotent rollback only during the observation window", async () => {
    const unavailable = await server.inject({
      method: "POST",
      url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}/rollback`,
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "search-rollback-0001",
        ...origin,
      },
      payload: { reasonCode: "ROLLBACK_DRILL" },
    });
    expect(unavailable.statusCode).toBe(422);
    store.markObserving(memorySearchRebuildId);
    const request = {
      method: "POST" as const,
      url: `/v1/admin/system/search/rebuilds/${memorySearchRebuildId}/rollback`,
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "search-rollback-0002",
        ...origin,
      },
      payload: { reasonCode: "ROLLBACK_DRILL", ticketRef: "DRILL-0050" },
    };
    const accepted = await server.inject(request);
    const retry = await server.inject(request);
    expect([accepted.statusCode, retry.statusCode]).toEqual([202, 202]);
    expect(retry.json()).toEqual(accepted.json());
    expect(accepted.json<SearchIndexOperationResponse>().data).toMatchObject({
      type: "SEARCH_INDEX_ROLLBACK",
      parentOperationId: memorySearchRebuildId,
      phase: "PENDING",
    });
  });
});
