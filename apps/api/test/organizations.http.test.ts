import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { MembershipRole, OrganizationMemberCollection } from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryOrganizationStore } from "./support/memory-organization.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-organization-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "organization-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "organization-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "organization-mfa-secret-with-more-than-32-bytes",
  CSRF_SECRET: "organization-csrf-secret-with-more-than-32-bytes",
});

const organizationId = "40000000-0000-4000-8000-000000000001";
const otherOrganizationId = "40000000-0000-4000-8000-000000000002";
const roles = ["OWNER", "ADMIN", "EDITOR", "BILLING", "ANALYST"] as const;
const userIds: Record<MembershipRole, string> = {
  OWNER: "10000000-0000-4000-8000-000000000001",
  ADMIN: "10000000-0000-4000-8000-000000000002",
  EDITOR: "10000000-0000-4000-8000-000000000003",
  BILLING: "10000000-0000-4000-8000-000000000004",
  ANALYST: "10000000-0000-4000-8000-000000000005",
};
const outsiderUserId = "10000000-0000-4000-8000-000000000006";
const limitedUserId = "10000000-0000-4000-8000-000000000007";

describe("organization HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    const organizationStore = new MemoryOrganizationStore();
    const joinedAt = new Date("2026-07-28T18:00:00.000Z");
    const members = roles.map((role, index) => ({
      userId: userIds[role],
      displayName: `Synthetic ${role}`,
      avatarUrl: null,
      role,
      joinedAt: new Date(joinedAt.getTime() + index * 1_000),
    }));

    for (const role of roles) {
      const userId = userIds[role];
      authStore.registerSubject(
        buildActiveSubject({ id: userId, displayName: `Synthetic ${role}` }),
      );
      authStore.registerOrganization(userId, {
        id: organizationId,
        type: "MERCHANT",
        displayName: "Synthetic Organization",
        slug: "synthetic-organization",
        role,
      });
      organizationStore.registerForUser(
        userId,
        {
          id: organizationId,
          type: "MERCHANT",
          displayName: "Synthetic Organization",
          legalName: "Synthetic Organization LLC",
          slug: "synthetic-organization",
          status: "ACTIVE",
          verificationStatus: "UNVERIFIED",
          role,
          createdAt: joinedAt,
          updatedAt: joinedAt,
        },
        members,
      );
    }
    authStore.registerSubject(buildActiveSubject({ id: outsiderUserId }));
    authStore.registerSubject(buildActiveSubject({ id: limitedUserId, status: "LIMITED" }));
    authStore.registerOrganization(limitedUserId, {
      id: organizationId,
      type: "MERCHANT",
      displayName: "Synthetic Organization",
      slug: "synthetic-organization",
      role: "OWNER",
    });
    organizationStore.registerForUser(
      limitedUserId,
      {
        id: organizationId,
        type: "MERCHANT",
        displayName: "Synthetic Organization",
        legalName: "Synthetic Organization LLC",
        slug: "synthetic-organization",
        status: "ACTIVE",
        verificationStatus: "UNVERIFIED",
        role: "OWNER",
        createdAt: joinedAt,
        updatedAt: joinedAt,
      },
      members,
    );

    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      organizationStore,
      observability: createObservabilityRuntime({
        serviceName: "socal-api-organization-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    for (const userId of [...Object.values(userIds), outsiderUserId, limitedUserId]) {
      const issued = await sessions.issueSession(userId, {});
      cookies.set(userId, `${environment.SESSION_COOKIE_NAME}=${issued.token}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates an organization with an initial OWNER and returns the exact owner retry", async () => {
    const payload = {
      type: "SERVICE_PROVIDER",
      displayName: "南加维修团队",
      legalName: "Synthetic Repair LLC",
      slug: "socal-repair-team",
    };
    const headers = {
      cookie: cookies.get(userIds.OWNER),
      origin: environment.PUBLIC_WEB_URL,
    };
    const created = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      headers,
      payload,
    });
    const retried = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      headers,
      payload,
    });

    expect(created.statusCode).toBe(201);
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toEqual(created.json());
    expect(created.headers.location).toMatch(/^\/v1\/organizations\/[0-9a-f-]+$/);
    expect(created.json()).toMatchObject({
      data: {
        type: "SERVICE_PROVIDER",
        displayName: "南加维修团队",
        legalName: "Synthetic Repair LLC",
        slug: "socal-repair-team",
        role: "OWNER",
        status: "ACTIVE",
        verificationStatus: "UNVERIFIED",
      },
    });
  });

  it("rejects unauthenticated, limited, internal, and over-posted organization creation", async () => {
    const base = {
      type: "MERCHANT",
      displayName: "Synthetic Merchant",
      slug: "synthetic-merchant",
    };
    const unauthenticated = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      payload: base,
    });
    const limited = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        cookie: cookies.get(limitedUserId),
        origin: environment.PUBLIC_WEB_URL,
      },
      payload: base,
    });
    const internal = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        cookie: cookies.get(userIds.OWNER),
        origin: environment.PUBLIC_WEB_URL,
      },
      payload: { ...base, type: "INTERNAL" },
    });
    const overPosted = await server.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: {
        cookie: cookies.get(userIds.OWNER),
        origin: environment.PUBLIC_WEB_URL,
      },
      payload: { ...base, status: "VERIFIED" },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(limited.statusCode).toBe(403);
    expect(limited.json()).toMatchObject({ detail: "Access denied" });
    expect(internal.statusCode).toBe(400);
    expect(overPosted.statusCode).toBe(400);
  });

  it("allows every current role to read its organization and hides cross-organization IDs", async () => {
    for (const role of roles) {
      const response = await server.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}`,
        headers: { cookie: cookies.get(userIds[role]) },
      });
      expect(response.statusCode, role).toBe(200);
      expect(response.json()).toMatchObject({
        data: { id: organizationId, role },
      });
      expect(response.body).not.toContain("@example.invalid");
    }

    const outsider = await server.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: cookies.get(outsiderUserId) },
    });
    const unknown = await server.inject({
      method: "GET",
      url: `/v1/organizations/${otherOrganizationId}`,
      headers: { cookie: cookies.get(userIds.OWNER) },
    });
    const guest = await server.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
    });
    const limited = await server.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: cookies.get(limitedUserId) },
    });

    expect(outsider.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(outsider.json()).toMatchObject({ detail: "The requested resource was not found." });
    expect(unknown.json()).toMatchObject({ detail: "The requested resource was not found." });
    expect(guest.statusCode).toBe(401);
    expect(limited.statusCode).toBe(403);
    expect(limited.json()).toMatchObject({ detail: "Access denied" });
  });

  it("limits member metadata to OWNER/ADMIN and binds signed cursors to actor and organization", async () => {
    for (const role of roles) {
      const response = await server.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}/members?limit=2`,
        headers: { cookie: cookies.get(userIds[role]) },
      });
      if (role === "OWNER" || role === "ADMIN") {
        expect(response.statusCode, role).toBe(200);
        expect(response.json<OrganizationMemberCollection>().data).toHaveLength(2);
        expect(response.body).not.toContain("@example.invalid");
      } else {
        expect(response.statusCode, role).toBe(403);
        expect(response.json()).toMatchObject({ detail: "Access denied" });
      }
    }

    const firstPage = await server.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members?limit=1`,
      headers: { cookie: cookies.get(userIds.OWNER) },
    });
    const cursor = firstPage.json<OrganizationMemberCollection>().pageInfo.nextCursor;
    const replayedByAdmin = await server.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members?limit=1&cursor=${encodeURIComponent(
        cursor ?? "",
      )}`,
      headers: { cookie: cookies.get(userIds.ADMIN) },
    });

    expect(cursor).toBeTruthy();
    expect(replayedByAdmin.statusCode).toBe(400);
    expect(replayedByAdmin.json()).toMatchObject({ detail: "Member cursor is invalid" });
  });
});
