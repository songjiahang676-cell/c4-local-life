import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { NotificationCollection, NotificationResponse } from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryNotificationStore } from "./support/memory-notification.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-notification-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "notification-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "notification-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "notification-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "notification-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "notification-csrf-secret-with-more-than-32-bytes",
});

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const limitedId = "10000000-0000-4000-8000-000000000003";
const notificationIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
] as const;
const listingIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
] as const;

describe("notification HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    const notificationStore = new MemoryNotificationStore();
    authStore.registerSubject(buildActiveSubject({ id: ownerId }));
    authStore.registerSubject(buildActiveSubject({ id: otherId }));
    authStore.registerSubject(buildActiveSubject({ id: limitedId, status: "LIMITED" }));
    notificationStore.register({
      id: notificationIds[0],
      userId: ownerId,
      templateKey: "listing.status.published",
      templateVersion: 1,
      locale: "zh-Hans",
      title: "信息已发布",
      body: "你的信息已发布。",
      resourceType: "LISTING",
      resourceId: listingIds[0],
      status: "UNREAD",
      createdAt: new Date("2026-07-30T03:00:00.000Z"),
      readAt: null,
    });
    notificationStore.register({
      id: notificationIds[1],
      userId: ownerId,
      templateKey: "listing.status.submitted",
      templateVersion: 1,
      locale: "zh-Hans",
      title: "信息已提交",
      body: "你的信息已提交审核。",
      resourceType: "LISTING",
      resourceId: listingIds[1],
      status: "UNREAD",
      createdAt: new Date("2026-07-30T02:00:00.000Z"),
      readAt: null,
    });
    notificationStore.register({
      id: notificationIds[2],
      userId: otherId,
      templateKey: "listing.status.rejected",
      templateVersion: 1,
      locale: "en-US",
      title: "Listing not approved",
      body: "Your listing was not approved.",
      resourceType: "LISTING",
      resourceId: listingIds[2],
      status: "UNREAD",
      createdAt: new Date("2026-07-30T04:00:00.000Z"),
      readAt: null,
    });

    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      notificationStore,
      observability: createObservabilityRuntime({
        serviceName: "socal-api-notification-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    for (const userId of [ownerId, otherId, limitedId]) {
      const issued = await sessions.issueSession(userId, {});
      cookies.set(userId, `${environment.SESSION_COOKIE_NAME}=${issued.token}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires authentication and permits limited accounts to read only their notifications", async () => {
    const guest = await server.inject({ method: "GET", url: "/v1/notifications" });
    const limited = await server.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: { cookie: cookies.get(limitedId) },
    });

    expect(guest.statusCode).toBe(401);
    expect(limited.statusCode).toBe(200);
    expect(limited.json<NotificationCollection>()).toMatchObject({
      data: [],
      unreadCount: 0,
    });
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.headers.vary).toContain("Cookie");
  });

  it("returns stable pages and binds signed cursors to the user and unread filter", async () => {
    const first = await server.inject({
      method: "GET",
      url: "/v1/notifications?limit=1",
      headers: { cookie: cookies.get(ownerId) },
    });
    const firstBody = first.json<NotificationCollection>();
    const cursor = firstBody.pageInfo.nextCursor;
    const second = await server.inject({
      method: "GET",
      url: `/v1/notifications?limit=1&cursor=${encodeURIComponent(cursor ?? "")}`,
      headers: { cookie: cookies.get(ownerId) },
    });
    const foreignReplay = await server.inject({
      method: "GET",
      url: `/v1/notifications?limit=1&cursor=${encodeURIComponent(cursor ?? "")}`,
      headers: { cookie: cookies.get(otherId) },
    });
    const filterReplay = await server.inject({
      method: "GET",
      url: `/v1/notifications?limit=1&unreadOnly=true&cursor=${encodeURIComponent(cursor ?? "")}`,
      headers: { cookie: cookies.get(ownerId) },
    });
    const tampered = await server.inject({
      method: "GET",
      url: `/v1/notifications?limit=1&cursor=${encodeURIComponent(`${cursor ?? ""}x`)}`,
      headers: { cookie: cookies.get(ownerId) },
    });

    expect(first.statusCode).toBe(200);
    expect(firstBody.data.map((item) => item.id)).toEqual([notificationIds[0]]);
    expect(firstBody.unreadCount).toBe(2);
    expect(cursor).toBeTruthy();
    expect(second.statusCode).toBe(200);
    expect(second.json<NotificationCollection>().data.map((item) => item.id)).toEqual([
      notificationIds[1],
    ]);
    expect(foreignReplay.statusCode).toBe(400);
    expect(filterReplay.statusCode).toBe(400);
    expect(tampered.statusCode).toBe(400);
  });

  it("marks owned notifications read idempotently and conceals foreign or unknown IDs", async () => {
    const read = await server.inject({
      method: "PUT",
      url: `/v1/notifications/${notificationIds[0]}/read`,
      headers: {
        cookie: cookies.get(ownerId),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const retried = await server.inject({
      method: "PUT",
      url: `/v1/notifications/${notificationIds[0]}/read`,
      headers: {
        cookie: cookies.get(ownerId),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const foreign = await server.inject({
      method: "PUT",
      url: `/v1/notifications/${notificationIds[2]}/read`,
      headers: {
        cookie: cookies.get(ownerId),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const unknown = await server.inject({
      method: "PUT",
      url: "/v1/notifications/20000000-0000-4000-8000-000000000099/read",
      headers: {
        cookie: cookies.get(ownerId),
        origin: environment.PUBLIC_WEB_URL,
      },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json<NotificationResponse>().data.status).toBe("READ");
    expect(read.json<NotificationResponse>().data.readAt).toBeTruthy();
    expect(retried.statusCode).toBe(200);
    expect(retried.json<NotificationResponse>().data.readAt).toBe(
      read.json<NotificationResponse>().data.readAt,
    );
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });

  it("rejects malformed IDs and unknown query parameters", async () => {
    const malformed = await server.inject({
      method: "PUT",
      url: "/v1/notifications/not-a-uuid/read",
      headers: {
        cookie: cookies.get(ownerId),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const overPosted = await server.inject({
      method: "GET",
      url: "/v1/notifications?admin=true",
      headers: { cookie: cookies.get(ownerId) },
    });
    const foreignOrigin = await server.inject({
      method: "PUT",
      url: `/v1/notifications/${notificationIds[1]}/read`,
      headers: {
        cookie: cookies.get(ownerId),
        origin: "https://attacker.example.invalid",
      },
    });

    expect(malformed.statusCode).toBe(400);
    expect(overPosted.statusCode).toBe(400);
    expect(foreignOrigin.statusCode).toBe(403);
  });
});
