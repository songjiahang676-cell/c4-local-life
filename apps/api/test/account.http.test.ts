import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { MyProfileResponse, ProblemDetails, SessionDeviceCollection } from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService, type IssuedSession } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";

const userId = "20000000-0000-4000-8000-000000000001";
const homeRegionId = "20000000-0000-4000-8000-000000000002";
const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "account-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "account-otp-secret-with-more-than-32-bytes",
  SESSION_ABSOLUTE_TTL_SECONDS: "1200",
  SESSION_IDLE_TTL_SECONDS: "600",
  SESSION_TOUCH_INTERVAL_SECONDS: "60",
  CSRF_SECRET: "account-csrf-secret-with-more-than-32-bytes",
});

describe("account-management HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let store: MemoryAuthSessionStore;
  let sessions: AuthSessionService;

  beforeAll(async () => {
    store = new MemoryAuthSessionStore();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: store,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    sessions = app.get(AuthSessionService);
  });

  beforeEach(() => {
    store.clear();
    store.registerSubject(
      buildActiveSubject({
        id: userId,
        displayName: "Synthetic Account User",
        preferredLocale: "zh-Hans",
      }),
    );
    store.registerRegion(homeRegionId);
  });

  afterAll(async () => {
    await app.close();
  });

  function cookie(issued: IssuedSession): string {
    return `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
  }

  async function issue(
    userAgent = "Synthetic Account Browser",
    now = new Date(),
  ): Promise<IssuedSession> {
    return sessions.issueSession(
      userId,
      {
        userAgent,
        ipAddress: "192.0.2.70",
      },
      now,
    );
  }

  it("reads and concurrency-updates only the safe profile projection", async () => {
    const issued = await issue();
    const initial = await server.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: cookie(issued) },
    });
    const initialPayload = initial.json<MyProfileResponse>();
    const etag = initial.headers.etag;

    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(etag).toBe('"profile-v1"');
    expect(initialPayload.data).toMatchObject({
      id: userId,
      displayName: "Synthetic Account User",
      preferredLocale: "zh-Hans",
      version: 1,
    });
    expect(JSON.stringify(initialPayload)).not.toContain("example.invalid");

    const updated = await server.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        cookie: cookie(issued),
        origin: environment.PUBLIC_WEB_URL,
        "if-match": etag,
        "content-type": "application/merge-patch+json",
      },
      payload: {
        displayName: "  Updated User  ",
        bio: "  Updated profile  ",
        preferredLocale: "en-US",
        homeRegionId,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"profile-v2"');
    expect(updated.json<MyProfileResponse>().data).toMatchObject({
      displayName: "Updated User",
      bio: "Updated profile",
      preferredLocale: "en-US",
      homeRegionId,
      version: 2,
    });

    const stale = await server.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        cookie: cookie(issued),
        origin: environment.PUBLIC_WEB_URL,
        "if-match": etag,
        "content-type": "application/merge-patch+json",
      },
      payload: { displayName: "Stale update" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<ProblemDetails>().detail).toBe("Profile version conflict");
  });

  it("rejects unsafe profile input, inactive regions, and foreign origins", async () => {
    const issued = await issue();
    const request = {
      method: "PATCH" as const,
      url: "/v1/me",
      headers: {
        cookie: cookie(issued),
        origin: environment.PUBLIC_WEB_URL,
        "if-match": '"profile-v1"',
        "content-type": "application/merge-patch+json",
      },
    };
    const [unsafe, unknown, inactiveRegion, foreignOrigin] = await Promise.all([
      server.inject({ ...request, payload: { displayName: "unsafe\u202Ename" } }),
      server.inject({ ...request, payload: { email: "private@example.invalid" } }),
      server.inject({ ...request, payload: { homeRegionId: randomUUID() } }),
      server.inject({
        ...request,
        headers: { ...request.headers, origin: "https://foreign.example.invalid" },
        payload: { displayName: "Blocked" },
      }),
    ]);

    expect(unsafe.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(inactiveRegion.statusCode).toBe(422);
    expect(foreignOrigin.statusCode).toBe(403);
  });

  it("lists active devices with a signed user-bound cursor and no secrets", async () => {
    const now = new Date();
    await issue("First Browser", new Date(now.getTime() - 20_000));
    await issue("Second Browser", new Date(now.getTime() - 10_000));
    const current = await issue("Current Browser", now);

    const firstPage = await server.inject({
      method: "GET",
      url: "/v1/me/sessions?limit=2",
      headers: { cookie: cookie(current) },
    });
    const firstPayload = firstPage.json<SessionDeviceCollection>();
    expect(firstPage.statusCode).toBe(200);
    expect(firstPayload.data).toHaveLength(2);
    expect(firstPayload.data[0]).toMatchObject({
      id: current.sessionId,
      current: true,
      userAgent: "Current Browser",
    });
    expect(firstPayload.pageInfo.hasMore).toBe(true);
    expect(firstPayload.pageInfo.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstPayload)).not.toContain(current.token);
    expect(JSON.stringify(firstPayload)).not.toContain("192.0.2.70");

    const secondPage = await server.inject({
      method: "GET",
      url: `/v1/me/sessions?limit=2&cursor=${encodeURIComponent(firstPayload.pageInfo.nextCursor ?? "")}`,
      headers: { cookie: cookie(current) },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json<SessionDeviceCollection>()).toMatchObject({
      data: [{ userAgent: "First Browser", current: false }],
      pageInfo: { hasMore: false, nextCursor: null },
    });

    const tampered = await server.inject({
      method: "GET",
      url: `/v1/me/sessions?cursor=${encodeURIComponent(`${firstPayload.pageInfo.nextCursor}x`)}`,
      headers: { cookie: cookie(current) },
    });
    expect(tampered.statusCode).toBe(400);

    const otherUserId = "20000000-0000-4000-8000-000000000099";
    store.registerSubject(
      buildActiveSubject({
        id: otherUserId,
        displayName: "Other Account",
      }),
    );
    const otherUser = await sessions.issueSession(otherUserId, {
      userAgent: "Other Browser",
    });
    const crossAccount = await server.inject({
      method: "GET",
      url: `/v1/me/sessions?cursor=${encodeURIComponent(firstPayload.pageInfo.nextCursor ?? "")}`,
      headers: { cookie: cookie(otherUser) },
    });
    expect(crossAccount.statusCode).toBe(400);
  });

  it("revokes only owned sessions without exposing foreign identifiers", async () => {
    const other = await issue("Other Device");
    const current = await issue("Current Device");
    const unknown = randomUUID();
    const unknownResponse = await server.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${unknown}`,
      headers: {
        cookie: cookie(current),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const revokeOther = await server.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${other.sessionId}`,
      headers: {
        cookie: cookie(current),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const otherAfter = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: cookie(other) },
    });
    const currentAfter = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: cookie(current) },
    });

    expect(unknownResponse.statusCode).toBe(204);
    expect(revokeOther.statusCode).toBe(204);
    expect(otherAfter.statusCode).toBe(401);
    expect(currentAfter.statusCode).toBe(200);

    const revokeCurrent = await server.inject({
      method: "DELETE",
      url: `/v1/me/sessions/${current.sessionId}`,
      headers: {
        cookie: cookie(current),
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    expect(revokeCurrent.statusCode).toBe(204);
    expect(revokeCurrent.headers["set-cookie"]).toContain("Max-Age=0");
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: cookie(current) },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("revokes every active device and expires the current cookie", async () => {
    const first = await issue("First Device");
    const current = await issue("Current Device");
    const response = await server.inject({
      method: "DELETE",
      url: "/v1/me/sessions",
      headers: {
        cookie: cookie(current),
        origin: environment.PUBLIC_WEB_URL,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
    for (const issued of [first, current]) {
      expect(
        (
          await server.inject({
            method: "GET",
            url: "/v1/auth/session",
            headers: { cookie: cookie(issued) },
          })
        ).statusCode,
      ).toBe(401);
    }
  });
});
