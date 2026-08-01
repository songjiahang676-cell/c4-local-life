import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  AdminJobResponse,
  AdminSessionResponse,
  QueueDeadLetterCollection,
} from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";
import {
  memoryOutboxFailureId,
  memoryQueueDeadLetterId,
  MemoryQueueOperationsStore,
} from "./support/memory-queue-operations.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-queue-operations-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "queue-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "queue-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "queue-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "queue-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "queue-csrf-secret-with-more-than-32-bytes",
});

const platformAdminId = "40000000-0000-4000-8000-000000000111";
const auditorId = "40000000-0000-4000-8000-000000000112";
const supportId = "40000000-0000-4000-8000-000000000113";
const originHeaders = { origin: environment.PUBLIC_ADMIN_URL };

describe("Admin queue operations HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let store: MemoryQueueOperationsStore;
  let adminCookie: string;
  let adminPrimaryCookie: string;
  let adminStaleCookie: string;
  let auditorCookie: string;
  let supportCookie: string;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    for (const [id, role] of [
      [platformAdminId, "PLATFORM_ADMIN"],
      [auditorId, "READ_ONLY_AUDITOR"],
      [supportId, "SUPPORT"],
    ] as const) {
      authStore.registerSubject(buildActiveSubject({ id, displayName: `Synthetic ${role}` }));
      authStore.registerPlatformRole(id, role);
    }
    store = new MemoryQueueOperationsStore();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mfaStore: new MemoryMfaStore(),
      queueOperationsStore: store,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);

    const adminPrimary = await sessions.issueSession(platformAdminId, {});
    adminPrimaryCookie = `${environment.SESSION_COOKIE_NAME}=${adminPrimary.token}`;
    const adminElevationSource = await sessions.issueSession(platformAdminId, {});
    const adminElevated = await sessions.elevateWithMfa(adminElevationSource.token, {});
    if (!adminElevated) throw new Error("Expected Admin MFA session");
    adminCookie = `${environment.SESSION_COOKIE_NAME}=${adminElevated.token}`;

    const oldNow = new Date(Date.now() - 11 * 60_000);
    const stalePrimary = await sessions.issueSession(platformAdminId, {}, oldNow);
    const staleElevated = await sessions.elevateWithMfa(stalePrimary.token, {}, oldNow);
    if (!staleElevated) throw new Error("Expected stale Admin MFA session");
    adminStaleCookie = `${environment.SESSION_COOKIE_NAME}=${staleElevated.token}`;

    const auditorPrimary = await sessions.issueSession(auditorId, {});
    const auditorElevated = await sessions.elevateWithMfa(auditorPrimary.token, {});
    if (!auditorElevated) throw new Error("Expected auditor MFA session");
    auditorCookie = `${environment.SESSION_COOKIE_NAME}=${auditorElevated.token}`;

    const supportPrimary = await sessions.issueSession(supportId, {});
    const supportElevated = await sessions.elevateWithMfa(supportPrimary.token, {});
    if (!supportElevated) throw new Error("Expected support MFA session");
    supportCookie = `${environment.SESSION_COOKIE_NAME}=${supportElevated.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists bounded privacy-minimized evidence for Admin and read-only auditor", async () => {
    const [admin, auditor, auditorSession] = await Promise.all([
      server.inject({
        method: "GET",
        url: "/v1/admin/system/queue/dead-letters?limit=20",
        headers: { cookie: adminCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/system/queue/dead-letters?source=QUEUE",
        headers: { cookie: auditorCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/session",
        headers: { cookie: auditorCookie },
      }),
    ]);
    expect([admin.statusCode, auditor.statusCode]).toEqual([200, 200]);
    expect(auditorSession.json<AdminSessionResponse>().data.navigation).toContainEqual({
      key: "system",
      href: "/admin/system/health",
    });
    expect(admin.headers["cache-control"]).toBe("no-store");
    const collection = admin.json<QueueDeadLetterCollection>();
    expect(collection.data).toHaveLength(2);
    expect(auditor.json<QueueDeadLetterCollection>().data).toHaveLength(1);
    expect(JSON.stringify(collection)).not.toMatch(
      /payload|aggregateId|aggregateType|rawError|failedReason|email|phone/i,
    );
  });

  it("requires the exact MFA-bound queue roles and bounded filters", async () => {
    const [guest, primary, support, invalid] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/admin/system/queue/dead-letters" }),
      server.inject({
        method: "GET",
        url: "/v1/admin/system/queue/dead-letters",
        headers: { cookie: adminPrimaryCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/system/queue/dead-letters",
        headers: { cookie: supportCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/system/queue/dead-letters?limit=51",
        headers: { cookie: adminCookie },
      }),
    ]);
    expect([guest.statusCode, primary.statusCode, support.statusCode, invalid.statusCode]).toEqual([
      401, 403, 403, 400,
    ]);
  });

  it("creates an explicit replay batch idempotently with recent MFA", async () => {
    const request = {
      method: "POST" as const,
      url: "/v1/admin/system/queue/replay-batches",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "queue-replay-batch-0001",
        ...originHeaders,
      },
      payload: {
        targets: [
          { source: "OUTBOX", targetId: memoryOutboxFailureId },
          { source: "QUEUE", targetId: memoryQueueDeadLetterId },
        ],
        reasonCode: "INCIDENT_RECOVERY",
        ticketRef: "INC-2026-0042",
      },
    };
    const first = await server.inject(request);
    const retry = await server.inject(request);
    expect([first.statusCode, retry.statusCode]).toEqual([202, 202]);
    expect(retry.json<AdminJobResponse>()).toEqual(first.json<AdminJobResponse>());
    expect(first.json<AdminJobResponse>().data).toMatchObject({
      type: "QUEUE_REPLAY",
      status: "PENDING",
      estimatedItems: 2,
    });
    expect(JSON.stringify(first.json())).not.toMatch(
      /reasonCode|ticketRef|idempotency|requestHash/i,
    );
  });

  it("denies replay to auditors/stale sessions and rejects changed or unavailable targets", async () => {
    const payload = {
      targets: [{ source: "QUEUE", targetId: memoryQueueDeadLetterId }],
      reasonCode: "INCIDENT_RECOVERY",
    };
    const make = (
      cookie: string,
      key: string,
      nextPayload = payload,
    ): Promise<{ statusCode: number }> =>
      server.inject({
        method: "POST",
        url: "/v1/admin/system/queue/replay-batches",
        headers: {
          cookie,
          "content-type": "application/json",
          "idempotency-key": key,
          ...originHeaders,
        },
        payload: nextPayload,
      });
    const [auditor, stale] = await Promise.all([
      make(auditorCookie, "queue-replay-batch-0002"),
      make(adminStaleCookie, "queue-replay-batch-0003"),
    ]);
    const original = await make(adminCookie, "queue-replay-batch-0004");
    const [changed, missing] = await Promise.all([
      make(adminCookie, "queue-replay-batch-0004", {
        ...payload,
        reasonCode: "MANUAL_RECOVERY",
      }),
      make(adminCookie, "queue-replay-batch-0005", {
        ...payload,
        targets: [{ source: "QUEUE" as const, targetId: "40000000-0000-4000-8000-000000000199" }],
      }),
    ]);
    expect(original.statusCode).toBe(202);
    expect([auditor.statusCode, stale.statusCode, changed.statusCode, missing.statusCode]).toEqual([
      403, 403, 409, 422,
    ]);
  });

  it("creates dry-run reconciliation and exposes only aggregate job progress", async () => {
    const accepted = await server.inject({
      method: "POST",
      url: "/v1/admin/system/queue/reconciliation-runs",
      headers: {
        cookie: adminCookie,
        "content-type": "application/json",
        "idempotency-key": "queue-reconciliation-0001",
        ...originHeaders,
      },
      payload: { dryRun: true, maxItems: 100, reasonCode: "DRIFT_CHECK" },
    });
    expect(accepted.statusCode).toBe(202);
    const job = accepted.json<AdminJobResponse>().data;
    expect(job).toMatchObject({
      type: "QUEUE_RECONCILIATION",
      dryRun: true,
      estimatedItems: 100,
    });
    const status = await server.inject({
      method: "GET",
      url: `/v1/admin/system/jobs/${job.id}`,
      headers: { cookie: auditorCookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<AdminJobResponse>().data).toEqual(job);
  });
});
