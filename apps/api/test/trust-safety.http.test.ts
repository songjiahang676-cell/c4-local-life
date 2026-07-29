import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  AppealModerationCaseDetailResponse,
  ModerationAppealReceiptResponse,
  ReportModerationCaseDetailResponse,
  ReportReceiptResponse,
  TrustSafetyActionResponse,
} from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";
import {
  memoryAppealId,
  memoryListingId,
  memoryReportId,
  memoryRemovalActionId,
  MemoryTrustSafetyStore,
} from "./support/memory-trust-safety.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-trust-safety-http-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "trust-safety-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "trust-safety-http-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "trust-safety-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "trust-safety-http-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "trust-safety-http-csrf-secret-with-more-than-32-bytes",
});
const reporterId = "40000000-0000-4000-8000-0000000000c1";
const ownerId = "40000000-0000-4000-8000-0000000000c2";
const moderatorId = "40000000-0000-4000-8000-0000000000c3";
const supportId = "40000000-0000-4000-8000-0000000000c4";

describe("Trust and safety HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let reporterCookie: string;
  let ownerCookie: string;
  let moderatorCookie: string;
  let primaryModeratorCookie: string;
  let supportCookie: string;
  let store: MemoryTrustSafetyStore;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    for (const [id, displayName] of [
      [reporterId, "Synthetic Reporter"],
      [ownerId, "Synthetic Owner"],
      [moderatorId, "Synthetic Moderator"],
      [supportId, "Synthetic Support"],
    ] as const) {
      authStore.registerSubject(buildActiveSubject({ id, displayName }));
    }
    authStore.registerPlatformRole(moderatorId, "MODERATOR");
    authStore.registerPlatformRole(supportId, "SUPPORT");
    store = new MemoryTrustSafetyStore();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mfaStore: new MemoryMfaStore(),
      trustSafetyStore: store,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    const reporter = await sessions.issueSession(reporterId, {});
    reporterCookie = `${environment.SESSION_COOKIE_NAME}=${reporter.token}`;
    const owner = await sessions.issueSession(ownerId, {});
    ownerCookie = `${environment.SESSION_COOKIE_NAME}=${owner.token}`;
    const moderatorPrimary = await sessions.issueSession(moderatorId, {});
    const moderator = await sessions.elevateWithMfa(moderatorPrimary.token, {});
    if (!moderator) throw new Error("Expected moderator MFA session");
    moderatorCookie = `${environment.SESSION_COOKIE_NAME}=${moderator.token}`;
    const separateModeratorPrimary = await sessions.issueSession(moderatorId, {});
    primaryModeratorCookie = `${environment.SESSION_COOKIE_NAME}=${separateModeratorPrimary.token}`;
    const supportPrimary = await sessions.issueSession(supportId, {});
    const support = await sessions.elevateWithMfa(supportPrimary.token, {});
    if (!support) throw new Error("Expected support MFA session");
    supportCookie = `${environment.SESSION_COOKIE_NAME}=${support.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts one bounded authenticated report and returns only an opaque receipt", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/reports",
      headers: {
        cookie: reporterCookie,
        origin: environment.PUBLIC_WEB_URL,
        "content-type": "application/json",
        "idempotency-key": "report-http-key-0001",
      },
      payload: {
        targetType: "LISTING",
        targetId: memoryListingId,
        reasonCode: "SCAM_OR_FRAUD",
        details: "The publisher requested an off-platform deposit.",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json<ReportReceiptResponse>().data).toMatchObject({
      id: memoryReportId,
      targetType: "LISTING",
      targetId: memoryListingId,
      reasonCode: "SCAM_OR_FRAUD",
      status: "OPEN",
    });
    expect(response.body).not.toMatch(/reporter|off-platform|email|phone/i);
  });

  it("returns a generic 429 when the authenticated report quota is exhausted", async () => {
    store.createReportResultOverride = { kind: "rate_limited" };
    const response = await server.inject({
      method: "POST",
      url: "/v1/reports",
      headers: {
        cookie: reporterCookie,
        origin: environment.PUBLIC_WEB_URL,
        "content-type": "application/json",
        "idempotency-key": "report-http-key-rate-limit",
      },
      payload: {
        targetType: "LISTING",
        targetId: memoryListingId,
        reasonCode: "OTHER",
      },
    });
    store.createReportResultOverride = undefined;

    expect(response.statusCode).toBe(429);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toMatch(/quota|count|reporter|email|phone/i);
  });

  it("rejects guests, invalid target kinds, mismatched origins, and missing retry keys", async () => {
    const payload = {
      targetType: "LISTING",
      targetId: memoryListingId,
      reasonCode: "SCAM_OR_FRAUD",
    };
    const [guest, invalidTarget, foreignOrigin, missingKey] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/reports",
        headers: {
          origin: environment.PUBLIC_WEB_URL,
          "content-type": "application/json",
          "idempotency-key": "report-http-key-0002",
        },
        payload,
      }),
      server.inject({
        method: "POST",
        url: "/v1/reports",
        headers: {
          cookie: reporterCookie,
          origin: environment.PUBLIC_WEB_URL,
          "content-type": "application/json",
          "idempotency-key": "report-http-key-0003",
        },
        payload: { ...payload, targetType: "MESSAGE" },
      }),
      server.inject({
        method: "POST",
        url: "/v1/reports",
        headers: {
          cookie: reporterCookie,
          origin: "https://attacker.example.invalid",
          "content-type": "application/json",
          "idempotency-key": "report-http-key-0004",
        },
        payload,
      }),
      server.inject({
        method: "POST",
        url: "/v1/reports",
        headers: {
          cookie: reporterCookie,
          origin: environment.PUBLIC_WEB_URL,
          "content-type": "application/json",
        },
        payload,
      }),
    ]);
    expect([
      guest.statusCode,
      invalidTarget.statusCode,
      foreignOrigin.statusCode,
      missingKey.statusCode,
    ]).toEqual([401, 400, 403, 400]);
  });

  it("requires an MFA moderator and never returns reporter identity in queue evidence", async () => {
    const [guest, primary, support, detailResponse] = await Promise.all([
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/reports",
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/reports",
        headers: { cookie: primaryModeratorCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/moderation/reports",
        headers: { cookie: supportCookie },
      }),
      server.inject({
        method: "GET",
        url: `/v1/admin/moderation/reports/${memoryReportId}`,
        headers: { cookie: moderatorCookie },
      }),
    ]);
    expect([guest.statusCode, primary.statusCode, support.statusCode]).toEqual([401, 403, 403]);
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.headers.etag).toBe('"trust-safety-case-v1"');
    const detail = detailResponse.json<ReportModerationCaseDetailResponse>().data;
    expect(detail.snapshot.sensitiveFieldsRedacted).toBe(true);
    expect(detail.availableActions).toEqual(["DISMISS", "REMOVE_CONTENT", "ESCALATE"]);
    expect(JSON.stringify(detail)).not.toMatch(/reporterId|reporter@|requestHash/i);
  });

  it("removes content through a recent-MFA, reason-bound, versioned action", async () => {
    const response = await server.inject({
      method: "POST",
      url: `/v1/admin/moderation/reports/${memoryReportId}/actions`,
      headers: {
        cookie: moderatorCookie,
        origin: environment.PUBLIC_ADMIN_URL,
        "content-type": "application/json",
        "idempotency-key": "report-action-http-key-0001",
        "if-match": '"trust-safety-case-v1"',
      },
      payload: {
        action: "REMOVE_CONTENT",
        reasonCode: "CONFIRMED_SCAM",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"trust-safety-case-v2"');
    expect(response.json<TrustSafetyActionResponse>().data).toMatchObject({
      action: "REMOVE_CONTENT",
      currentContentStatus: "SUSPENDED",
      currentModerationStatus: "REJECTED",
      listingVersion: 5,
    });
    expect(store.reportActions).toHaveLength(1);
  });

  it("accepts the owner appeal and lets the independent moderator restore it", async () => {
    const submitted = await server.inject({
      method: "POST",
      url: "/v1/appeals",
      headers: {
        cookie: ownerCookie,
        origin: environment.PUBLIC_WEB_URL,
        "content-type": "application/json",
        "idempotency-key": "appeal-http-key-0001",
      },
      payload: {
        moderationActionId: memoryRemovalActionId,
        statement: "The cited claim is supported by the attached public record.",
      },
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json<ModerationAppealReceiptResponse>().data).toMatchObject({
      id: memoryAppealId,
      status: "OPEN",
    });

    const detailResponse = await server.inject({
      method: "GET",
      url: `/v1/admin/moderation/appeals/${memoryAppealId}`,
      headers: { cookie: moderatorCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json<AppealModerationCaseDetailResponse>().data;
    expect(detail.availableActions).toEqual(["UPHOLD", "RESTORE"]);
    expect(detail.originalAction).not.toHaveProperty("actorId");

    const restored = await server.inject({
      method: "POST",
      url: `/v1/admin/moderation/appeals/${memoryAppealId}/actions`,
      headers: {
        cookie: moderatorCookie,
        origin: environment.PUBLIC_ADMIN_URL,
        "content-type": "application/json",
        "idempotency-key": "appeal-action-http-key-0001",
        "if-match": '"trust-safety-case-v1"',
      },
      payload: { action: "RESTORE", reasonCode: "ACTION_OVERTURNED" },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json<TrustSafetyActionResponse>().data).toMatchObject({
      action: "RESTORE",
      currentContentStatus: "PUBLISHED",
      currentModerationStatus: "APPROVED",
      listingVersion: 6,
    });
  });

  it("rejects action/reason mismatches and missing concurrency evidence", async () => {
    const url = `/v1/admin/moderation/appeals/${memoryAppealId}/actions`;
    const [invalidReason, missingMatch] = await Promise.all([
      server.inject({
        method: "POST",
        url,
        headers: {
          cookie: moderatorCookie,
          origin: environment.PUBLIC_ADMIN_URL,
          "content-type": "application/json",
          "idempotency-key": "appeal-action-http-key-0002",
          "if-match": '"trust-safety-case-v1"',
        },
        payload: { action: "UPHOLD", reasonCode: "ACTION_OVERTURNED" },
      }),
      server.inject({
        method: "POST",
        url,
        headers: {
          cookie: moderatorCookie,
          origin: environment.PUBLIC_ADMIN_URL,
          "content-type": "application/json",
          "idempotency-key": "appeal-action-http-key-0003",
        },
        payload: { action: "UPHOLD", reasonCode: "ACTION_CONFIRMED" },
      }),
    ]);
    expect([invalidReason.statusCode, missingMatch.statusCode]).toEqual([400, 400]);
  });
});
