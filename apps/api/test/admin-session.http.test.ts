import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { AdminSessionResponse } from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-admin-session-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "admin-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "admin-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "admin-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "admin-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "admin-csrf-secret-with-more-than-32-bytes",
});

const moderatorId = "10000000-0000-4000-8000-000000000061";
const ordinaryUserId = "10000000-0000-4000-8000-000000000062";
const limitedStaffId = "10000000-0000-4000-8000-000000000063";

describe("Admin session HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let sessions: AuthSessionService;
  let moderatorCookie: string;
  let ordinaryCookie: string;
  let limitedStaffCookie: string;

  beforeAll(async () => {
    const store = new MemoryAuthSessionStore();
    store.registerSubject(
      buildActiveSubject({
        id: moderatorId,
        displayName: "Synthetic Moderator",
        preferredLocale: "en-US",
      }),
    );
    store.registerPlatformRole(moderatorId, "SENIOR_MODERATOR");
    store.registerPlatformRole(moderatorId, "MODERATOR");
    store.registerSubject(buildActiveSubject({ id: ordinaryUserId }));
    store.registerSubject(buildActiveSubject({ id: limitedStaffId, status: "LIMITED" }));
    store.registerPlatformRole(limitedStaffId, "SUPPORT");

    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: store,
      mfaStore: new MemoryMfaStore(),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    sessions = app.get(AuthSessionService);
    moderatorCookie = await issueCookie(moderatorId);
    ordinaryCookie = await issueCookie(ordinaryUserId);
    limitedStaffCookie = await issueCookie(limitedStaffId);
  });

  afterAll(async () => {
    await app.close();
  });

  async function issueCookie(userId: string): Promise<string> {
    const issued = await sessions.issueSession(userId, {});
    return `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
  }

  it("returns a no-store role and navigation projection without privileged data", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/admin/session",
      headers: { cookie: moderatorCookie },
    });
    const payload = response.json<AdminSessionResponse>();

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers.vary).toContain("Cookie");
    expect(payload.data).toEqual({
      operator: {
        id: moderatorId,
        displayName: "Synthetic Moderator",
        avatarUrl: null,
        locale: "en-US",
        status: "ACTIVE",
        verificationBadges: [],
      },
      roles: ["MODERATOR", "SENIOR_MODERATOR"],
      navigation: [
        { key: "moderation", href: "/admin/moderation/listings" },
        { key: "people", href: "/admin/users" },
      ],
      security: {
        mfaRequired: true,
        mfaEnrolled: false,
        authenticationStrength: "PRIMARY",
        mfaVerifiedAt: null,
        stepUpExpiresAt: null,
        privilegedActionsAllowed: false,
        sensitiveActionsAllowed: false,
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/email|phone|trustScore|token|scope/i);
  });

  it("returns generic 401/403 and no-store for guests and actors without effective staff access", async () => {
    const [guest, ordinary, limited] = await Promise.all([
      server.inject({ method: "GET", url: "/v1/admin/session" }),
      server.inject({
        method: "GET",
        url: "/v1/admin/session",
        headers: { cookie: ordinaryCookie },
      }),
      server.inject({
        method: "GET",
        url: "/v1/admin/session",
        headers: { cookie: limitedStaffCookie },
      }),
    ]);

    expect(guest.statusCode).toBe(401);
    expect(ordinary.statusCode).toBe(403);
    expect(limited.statusCode).toBe(403);
    for (const response of [guest, ordinary, limited]) {
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toMatch(/role|permission|LIMITED|SUPPORT/);
    }
  });
});
