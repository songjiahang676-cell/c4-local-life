import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import {
  allowPolicy,
  denyPolicy,
  ownerOrOrganizationPolicy,
  PolicyService,
  requireActorPermissionPolicy,
  type AuthenticatedActor,
  type PolicyActor,
  type PolicyRequestContext,
} from "../src/common/authorization/policy";
import { createPolicyService } from "../src/common/authorization/authorization.module";
import { RequestContextAccessor } from "../src/common/authorization/request-context";
import { expectPolicyMatrix } from "./support/policy-matrix";
import type { Session } from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

const ownerUserId = "10000000-0000-4000-8000-000000000001";
const unrelatedUserId = "10000000-0000-4000-8000-000000000002";
const organizationId = "20000000-0000-4000-8000-000000000001";
const otherOrganizationId = "20000000-0000-4000-8000-000000000002";

function authenticatedActor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    kind: "authenticated",
    userId: unrelatedUserId,
    sessionId: "30000000-0000-4000-8000-000000000001",
    accountStatus: "ACTIVE",
    verificationBadges: [],
    permissions: [],
    organizations: [],
    ...overrides,
  };
}

function requestContext(actor: PolicyActor): PolicyRequestContext {
  return {
    requestId: "policy-test-request",
    method: "PATCH",
    route: "/v1/listings/:listingId",
    actor,
  };
}

describe("PolicyService", () => {
  it("fails closed for unknown actions, duplicate registration, and evaluator errors", async () => {
    const policies = new PolicyService();
    const context = requestContext(authenticatedActor());

    await expect(policies.evaluate({ action: "listing:unknown", context })).resolves.toEqual(
      denyPolicy("UNKNOWN_ACTION"),
    );
    expect(() => policies.register("invalid action", () => allowPolicy())).toThrow(TypeError);

    policies.register("listing:update", () => {
      throw new Error("synthetic policy failure");
    });
    expect(() => policies.register("listing:update", () => allowPolicy())).toThrow(
      "already registered",
    );
    await expect(policies.evaluate({ action: "listing:update", context })).resolves.toEqual(
      denyPolicy("POLICY_EVALUATION_FAILED"),
    );

    policies.register("listing:publish", () => allowPolicy());
    await expect(
      policies.evaluate({
        action: "listing:publish",
        context: requestContext(authenticatedActor({ accountStatus: "SUSPENDED" })),
      }),
    ).resolves.toEqual(denyPolicy("ACCOUNT_RESTRICTED"));
  });

  it("supports a reusable owner/organization object-level authorization matrix", async () => {
    const policies = new PolicyService();
    policies.register(
      "listing:update",
      ownerOrOrganizationPolicy({
        allowOwner: true,
        organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
      }),
    );
    const resource = {
      type: "listing",
      id: "40000000-0000-4000-8000-000000000001",
      ownerUserId,
      organizationId,
      state: "DRAFT",
      deleted: false,
    };

    await expectPolicyMatrix(policies, "listing:update", [
      {
        name: "guest",
        context: requestContext({ kind: "guest" }),
        resource,
        expected: denyPolicy("AUTHENTICATION_REQUIRED"),
      },
      {
        name: "resource owner",
        context: requestContext(authenticatedActor({ userId: ownerUserId })),
        resource,
        expected: allowPolicy(),
      },
      {
        name: "organization editor",
        context: requestContext(
          authenticatedActor({
            organizations: [{ organizationId, role: "EDITOR" }],
          }),
        ),
        resource,
        expected: allowPolicy(),
      },
      {
        name: "organization billing role",
        context: requestContext(
          authenticatedActor({
            organizations: [{ organizationId, role: "BILLING" }],
          }),
        ),
        resource,
        expected: denyPolicy("OBJECT_ACCESS_DENIED"),
      },
      {
        name: "cross-organization editor",
        context: requestContext(
          authenticatedActor({
            organizations: [{ organizationId: otherOrganizationId, role: "EDITOR" }],
          }),
        ),
        resource,
        expected: denyPolicy("OBJECT_ACCESS_DENIED"),
      },
      {
        name: "unrelated user",
        context: requestContext(authenticatedActor()),
        resource,
        expected: denyPolicy("OBJECT_ACCESS_DENIED"),
      },
      {
        name: "limited account",
        context: requestContext(
          authenticatedActor({ userId: ownerUserId, accountStatus: "LIMITED" }),
        ),
        resource,
        expected: denyPolicy("ACCOUNT_RESTRICTED"),
      },
      {
        name: "deleted resource",
        context: requestContext(authenticatedActor({ userId: ownerUserId })),
        resource: { ...resource, deleted: true },
        expected: denyPolicy("RESOURCE_UNAVAILABLE"),
      },
      {
        name: "missing scoped resource",
        context: requestContext(authenticatedActor({ userId: ownerUserId })),
        expected: denyPolicy("RESOURCE_UNAVAILABLE"),
      },
    ]);
  });

  it("maps authentication failures to 401 and all other denials to a generic 403", async () => {
    const policies = new PolicyService();
    policies.register("account:profile:update", requireActorPermissionPolicy);

    await expect(
      policies.require({
        action: "account:profile:update",
        context: requestContext({ kind: "guest" }),
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      policies.require({
        action: "account:profile:update",
        context: requestContext(authenticatedActor()),
      }),
    ).rejects.toMatchObject({
      constructor: ForbiddenException,
      message: "Access denied",
    });
    await expect(
      policies.require({
        action: "account:profile:update",
        context: requestContext(authenticatedActor({ permissions: ["account:profile:update"] })),
      }),
    ).resolves.toBeUndefined();
  });

  it("enforces the complete organization role/action matrix", async () => {
    const policies = createPolicyService();
    const resource = {
      type: "organization",
      id: organizationId,
      organizationId,
      state: "ACTIVE",
      deleted: false,
    };
    const roles = ["OWNER", "ADMIN", "EDITOR", "BILLING", "ANALYST"] as const;
    type OrganizationRole = (typeof roles)[number];
    const matrix: Record<string, ReadonlySet<OrganizationRole>> = {
      "organization:profile:read": new Set(roles),
      "organization:profile:edit": new Set(["OWNER", "ADMIN", "EDITOR"]),
      "organization:profile:manage": new Set(["OWNER", "ADMIN"]),
      "organization:listings:write": new Set(["OWNER", "ADMIN", "EDITOR"]),
      "organization:members:read": new Set(["OWNER", "ADMIN"]),
      "organization:members:manage": new Set(["OWNER", "ADMIN"]),
      "organization:billing:manage": new Set(["OWNER", "BILLING"]),
      "organization:analytics:read": new Set(["OWNER", "ADMIN", "BILLING", "ANALYST"]),
    };

    for (const [action, allowedRoles] of Object.entries(matrix)) {
      await expectPolicyMatrix(
        policies,
        action,
        roles.map((role) => ({
          name: `${action} ${role}`,
          context: requestContext(
            authenticatedActor({
              organizations: [{ organizationId, role }],
            }),
          ),
          resource,
          expected: allowedRoles.has(role) ? allowPolicy() : denyPolicy("OBJECT_ACCESS_DENIED"),
        })),
      );
    }
  });
});

describe("RequestContextAccessor", () => {
  it("creates a PII-minimized immutable guest or authenticated actor per request", () => {
    const contexts = new RequestContextAccessor();
    const request = {
      id: "request-context-test",
      method: "GET",
      url: "/v1/me?ignored=true",
      routeOptions: { url: "/v1/me" },
    } as FastifyRequest;

    contexts.initialize(request, null);
    expect(contexts.require(request)).toEqual({
      requestId: "request-context-test",
      method: "GET",
      route: "/v1/me",
      actor: { kind: "guest" },
    });

    const session: Session = {
      user: {
        id: ownerUserId,
        displayName: "Must not enter actor",
        avatarUrl: null,
        locale: "zh-Hans",
        status: "ACTIVE",
        verificationBadges: [],
      },
      expiresAt: "2026-07-29T00:00:00.000Z",
      permissions: ["account:profile:read"],
      organizations: [
        {
          id: organizationId,
          type: "MERCHANT",
          displayName: "Must not enter actor",
          slug: "synthetic-org",
          role: "OWNER",
        },
      ],
    };
    contexts.initialize(request, {
      sessionId: "30000000-0000-4000-8000-000000000001",
      response: session,
    });
    const actor = contexts.require(request).actor;

    expect(actor).toEqual({
      kind: "authenticated",
      userId: ownerUserId,
      sessionId: "30000000-0000-4000-8000-000000000001",
      accountStatus: "ACTIVE",
      verificationBadges: [],
      permissions: ["account:profile:read"],
      organizations: [{ organizationId, role: "OWNER" }],
    });
    expect(JSON.stringify(actor)).not.toContain("Must not enter actor");
    expect(Object.isFrozen(actor)).toBe(true);
    if (actor.kind === "authenticated") {
      expect(Object.isFrozen(actor.verificationBadges)).toBe(true);
      expect(Object.isFrozen(actor.permissions)).toBe(true);
      expect(Object.isFrozen(actor.organizations)).toBe(true);
    }
  });
});
