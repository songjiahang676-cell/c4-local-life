import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { ProblemDetails, SessionResponse } from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "test-otp-secret-with-more-than-32-bytes",
  SESSION_ABSOLUTE_TTL_SECONDS: "1200",
  SESSION_IDLE_TTL_SECONDS: "600",
  SESSION_TOUCH_INTERVAL_SECONDS: "60",
  CSRF_SECRET: "test-csrf-secret-with-more-than-32-bytes",
});

describe("auth session HTTP boundary", () => {
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
    store.registerSubject(
      buildActiveSubject({
        id: "10000000-0000-4000-8000-000000000001",
        displayName: "Synthetic HTTP User",
        preferredLocale: "en-US",
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueCookie(): Promise<{ cookie: string; token: string }> {
    const issued = await sessions.issueSession("10000000-0000-4000-8000-000000000001", {
      userAgent: "Synthetic Test Browser",
      ipAddress: "192.0.2.50",
    });
    return {
      cookie: `${environment.SESSION_COOKIE_NAME}=${issued.token}`,
      token: issued.token,
    };
  }

  it("resolves a valid cookie into the contract-safe current session", async () => {
    const issued = await issueCookie();
    const response = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: issued.cookie },
    });
    const payload = response.json<SessionResponse>();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(payload.data).toMatchObject({
      user: {
        id: "10000000-0000-4000-8000-000000000001",
        displayName: "Synthetic HTTP User",
        locale: "en-US",
        status: "ACTIVE",
      },
      permissions: [],
      organizations: [],
    });
    expect(JSON.stringify(payload)).not.toContain(issued.token);
  });

  it("returns RFC 9457 Unauthorized for absent, malformed, or duplicate bearer cookies", async () => {
    const token = "a".repeat(43);
    const responses = await Promise.all([
      server.inject({ method: "GET", url: "/v1/auth/session" }),
      server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: `${environment.SESSION_COOKIE_NAME}=malformed` },
      }),
      server.inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: {
          cookie: `${environment.SESSION_COOKIE_NAME}=${token}; ${environment.SESSION_COOKIE_NAME}=${"b".repeat(43)}`,
        },
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.json<ProblemDetails>()).toMatchObject({
        title: "Unauthorized",
        status: 401,
        detail: "Authentication required",
      });
    }
  });

  it("revokes logout idempotently and expires the hardened cookie", async () => {
    const issued = await issueCookie();
    const logout = await server.inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: {
        cookie: issued.cookie,
        origin: environment.PUBLIC_WEB_URL,
      },
    });
    const afterLogout = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: issued.cookie },
    });
    const repeatedLogout = await server.inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: {
        cookie: issued.cookie,
        origin: environment.PUBLIC_WEB_URL,
      },
    });

    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(logout.headers["set-cookie"]).toContain("HttpOnly");
    expect(logout.headers["set-cookie"]).toContain("Secure");
    expect(afterLogout.statusCode).toBe(401);
    expect(repeatedLogout.statusCode).toBe(204);
  });

  it("blocks a foreign-origin logout before it can revoke the session", async () => {
    const issued = await issueCookie();
    const blocked = await server.inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: {
        cookie: issued.cookie,
        origin: "https://foreign.example.invalid",
      },
    });
    const stillActive = await server.inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: issued.cookie },
    });

    expect(blocked.statusCode).toBe(403);
    expect(stillActive.statusCode).toBe(200);
  });
});
