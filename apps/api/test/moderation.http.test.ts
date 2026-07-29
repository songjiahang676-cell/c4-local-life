import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  ModerationActionResponse,
  ModerationCaseCollection,
  ModerationCaseDetailResponse,
} from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";
import { memoryModerationCaseId, MemoryModerationStore } from "./support/memory-moderation.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-moderation-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "moderation-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "moderation-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "moderation-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "moderation-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "moderation-csrf-secret-with-more-than-32-bytes",
});

const moderatorId = "40000000-0000-4000-8000-000000000091";
const supportId = "40000000-0000-4000-8000-000000000092";
const originHeaders = { origin: environment.PUBLIC_ADMIN_URL };

describe("Admin moderation HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let sessions: AuthSessionService;
  let moderatorCookie: string;
  let primaryModeratorCookie: string;
  let staleStepUpCookie: string;
  let supportCookie: string;
  let store: MemoryModerationStore;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    authStore.registerSubject(
      buildActiveSubject({ id: moderatorId, displayName: "Synthetic Moderator" }),
    );
    authStore.registerPlatformRole(moderatorId, "MODERATOR");
    authStore.registerSubject(
      buildActiveSubject({ id: supportId, displayName: "Synthetic Support" }),
    );
    authStore.registerPlatformRole(supportId, "SUPPORT");
    store = new MemoryModerationStore();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mfaStore: new MemoryMfaStore(),
      moderationStore: store,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    sessions = app.get(AuthSessionService);

    const primary = await sessions.issueSession(moderatorId, {});
    const elevated = await sessions.elevateWithMfa(primary.token, {});
    if (!elevated) throw new Error("Expected moderator MFA session");
    moderatorCookie = `${environment.SESSION_COOKIE_NAME}=${elevated.token}`;
    const separatePrimary = await sessions.issueSession(moderatorId, {});
    primaryModeratorCookie = `${environment.SESSION_COOKIE_NAME}=${separatePrimary.token}`;

    const oldNow = new Date(Date.now() - 11 * 60_000);
    const stalePrimary = await sessions.issueSession(moderatorId, {}, oldNow);
    const staleElevated = await sessions.elevateWithMfa(stalePrimary.token, {}, oldNow);
    if (!staleElevated) throw new Error("Expected stale MFA session");
    staleStepUpCookie = `${environment.SESSION_COOKIE_NAME}=${staleElevated.token}`;

    const supportPrimary = await sessions.issueSession(supportId, {});
    const supportElevated = await sessions.elevateWithMfa(supportPrimary.token, {});
    if (!supportElevated) throw new Error("Expected support MFA session");
    supportCookie = `${environment.SESSION_COOKIE_NAME}=${supportElevated.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists priority/SLA summaries and returns an immutable redacted snapshot", async () => {
    const queue = await server.inject({
      method: "GET",
      url: "/v1/admin/moderation/cases?queue=listing-submission&status=OPEN&limit=20",
      headers: { cookie: moderatorCookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.headers["cache-control"]).toBe("no-store");
    const collection = queue.json<ModerationCaseCollection>();
    expect(collection.data).toHaveLength(1);
    expect(collection.data[0]).toMatchObject({
      id: memoryModerationCaseId,
      priority: 80,
      riskTier: "HIGH",
      version: 1,
      ruleCodes: ["EXTERNAL_PAYMENT_REQUEST"],
    });
    expect(collection.data[0]?.slaDueAt).toMatch(/Z$/);
    expect(collection.page).toEqual({ hasMore: false, nextCursor: null });

    const detailResponse = await server.inject({
      method: "GET",
      url: `/v1/admin/moderation/cases/${memoryModerationCaseId}`,
      headers: { cookie: moderatorCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.headers.etag).toBe('"moderation-case-v1"');
    const detail = detailResponse.json<ModerationCaseDetailResponse>().data;
    expect(detail.snapshot.sensitiveFieldsRedacted).toBe(true);
    expect(detail.snapshot.attributes).toEqual({ bedrooms: 2 });
    expect(detail.diff.every((entry) => entry.kind === "ADDED")).toBe(true);
    expect(detail.rules).toEqual([
      {
        ruleCode: "EXTERNAL_PAYMENT_REQUEST",
        ruleVersion: 1,
        severity: "HIGH",
        evidenceKey: "body",
      },
    ]);
    expect(detail.availableActions).toEqual(["APPROVE", "REQUEST_CHANGES", "REJECT"]);
    expect(JSON.stringify(detail)).not.toMatch(/email|phone|requestHash|idempotencyKey/i);
  });

  it("requires an MFA-bound moderator role and rejects malformed bounded queries", async () => {
    const [guest, primary, support, invalidQuery] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/admin/moderation/cases" }),
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/cases",
        headers: { cookie: primaryModeratorCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/cases",
        headers: { cookie: supportCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/cases?limit=51",
        headers: { cookie: moderatorCookie },
      }),
    ]);
    expect([
      guest.statusCode,
      primary.statusCode,
      support.statusCode,
      invalidQuery.statusCode,
    ]).toEqual([401, 403, 403, 400]);
    for (const response of [guest, primary, support, invalidQuery]) {
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toMatch(/MODERATOR|SUPPORT|MFA-bound/i);
    }
  });

  it("commits a recent-MFA action idempotently and returns strong case concurrency evidence", async () => {
    const request = {
      method: "POST" as const,
      url: `/v1/admin/moderation/cases/${memoryModerationCaseId}/actions`,
      headers: {
        cookie: moderatorCookie,
        "content-type": "application/json",
        "if-match": '"moderation-case-v1"',
        "idempotency-key": "moderation-action-key-0001",
        ...originHeaders,
      },
      payload: {
        action: "APPROVE",
        reasonCode: "CONTENT_POLICY_COMPLIANT",
        note: "Synthetic policy review completed.",
      },
    };
    const first = await server.inject(request);
    const retry = await server.inject(request);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(first.headers.etag).toBe('"moderation-case-v2"');
    const payload = first.json<ModerationActionResponse>();
    expect(retry.json<ModerationActionResponse>()).toEqual(payload);
    expect(payload.data).toMatchObject({
      caseId: memoryModerationCaseId,
      action: "APPROVE",
      currentCaseStatus: "RESOLVED",
      currentContentStatus: "PUBLISHED",
      currentModerationStatus: "APPROVED",
      caseVersion: 2,
      listingVersion: 4,
    });
    expect(JSON.stringify(payload)).not.toContain("Synthetic policy review");
    expect(store.commitInputs).toHaveLength(2);
  });

  it("requires recent step-up, exact reason coupling, If-Match, and unchanged idempotent input", async () => {
    const baseUrl = `/v1/admin/moderation/cases/${memoryModerationCaseId}/actions`;
    const [staleMfa, missingMatch, invalidReason, changedRetry] = await Promise.all([
      server.inject({
        method: "POST",
        url: baseUrl,
        headers: {
          cookie: staleStepUpCookie,
          "content-type": "application/json",
          "if-match": '"moderation-case-v1"',
          "idempotency-key": "moderation-action-key-0002",
          ...originHeaders,
        },
        payload: { action: "REJECT", reasonCode: "PROHIBITED_CONTENT" },
      }),
      server.inject({
        method: "POST",
        url: baseUrl,
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
          "idempotency-key": "moderation-action-key-0003",
          ...originHeaders,
        },
        payload: { action: "REJECT", reasonCode: "PROHIBITED_CONTENT" },
      }),
      server.inject({
        method: "POST",
        url: baseUrl,
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
          "if-match": '"moderation-case-v1"',
          "idempotency-key": "moderation-action-key-0004",
          ...originHeaders,
        },
        payload: { action: "APPROVE", reasonCode: "PROHIBITED_CONTENT" },
      }),
      server.inject({
        method: "POST",
        url: baseUrl,
        headers: {
          cookie: moderatorCookie,
          "content-type": "application/json",
          "if-match": '"moderation-case-v1"',
          "idempotency-key": "moderation-action-key-0001",
          ...originHeaders,
        },
        payload: { action: "REJECT", reasonCode: "EXTERNAL_PAYMENT_RISK" },
      }),
    ]);
    expect([
      staleMfa.statusCode,
      missingMatch.statusCode,
      invalidReason.statusCode,
      changedRetry.statusCode,
    ]).toEqual([403, 400, 400, 409]);
    for (const response of [staleMfa, missingMatch, invalidReason, changedRetry]) {
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });
});
