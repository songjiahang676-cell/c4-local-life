import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  AdminNavigationItem,
  AdminSessionResponse,
  PlatformRole,
  Session,
} from "@socal/contracts";
import {
  adminPolicyActions,
  PolicyService,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { MFA_STORE, type MfaStore } from "./mfa.store";

const roleOrder: readonly PlatformRole[] = [
  "SUPPORT",
  "MODERATOR",
  "SENIOR_MODERATOR",
  "AD_OPS",
  "FINANCE",
  "TAXONOMY_ADMIN",
  "PLATFORM_ADMIN",
  "READ_ONLY_AUDITOR",
];

const navigationByRole: Readonly<Record<PlatformRole, readonly AdminNavigationItem[]>> = {
  SUPPORT: [{ key: "people", href: "/admin/users" }],
  MODERATOR: [{ key: "moderation", href: "/admin/moderation/listings" }],
  SENIOR_MODERATOR: [
    { key: "moderation", href: "/admin/moderation/listings" },
    { key: "people", href: "/admin/users" },
  ],
  AD_OPS: [{ key: "ads", href: "/admin/ads/campaigns" }],
  FINANCE: [{ key: "commerce", href: "/admin/commerce/orders" }],
  TAXONOMY_ADMIN: [{ key: "taxonomy", href: "/admin/taxonomy/categories" }],
  PLATFORM_ADMIN: [
    { key: "system", href: "/admin/system/health" },
    { key: "audit", href: "/admin/audit" },
  ],
  READ_ONLY_AUDITOR: [{ key: "audit", href: "/admin/audit" }],
};

function orderedRoles(roles: readonly PlatformRole[]): PlatformRole[] {
  const unique = new Set(roles);
  return roleOrder.filter((role) => unique.has(role));
}

function navigationForRoles(roles: readonly PlatformRole[]): AdminNavigationItem[] {
  const seen = new Set<AdminNavigationItem["key"]>();
  return roles.flatMap((role) =>
    navigationByRole[role].filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    }),
  );
}

@Injectable()
export class AdminSessionService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MFA_STORE) private readonly mfa: MfaStore,
    private readonly policies: PolicyService,
  ) {}

  async getSession(
    context: PolicyRequestContext,
    session: Session | null,
  ): Promise<AdminSessionResponse> {
    await this.policies.require({
      action: adminPolicyActions.consoleAccess,
      context,
    });
    if (!session || context.actor.kind === "guest") {
      throw new UnauthorizedException("Authentication required");
    }

    const roles = orderedRoles(context.actor.platformRoles);
    const now = new Date();
    const mfaState = await this.mfa.findState(context.actor.userId, now);
    const mfaVerifiedAt = context.actor.mfaVerifiedAt;
    const stepUpExpiresAt = mfaVerifiedAt
      ? new Date(
          new Date(mfaVerifiedAt).getTime() + this.environment.ADMIN_STEP_UP_TTL_SECONDS * 1_000,
        ).toISOString()
      : null;
    return {
      data: {
        operator: session.user,
        roles,
        navigation: navigationForRoles(roles),
        security: {
          mfaRequired: true,
          mfaEnrolled: mfaState.status === "ACTIVE",
          authenticationStrength: context.actor.authenticationStrength,
          mfaVerifiedAt,
          stepUpExpiresAt,
          privilegedActionsAllowed: context.actor.authenticationStrength === "MFA",
          sensitiveActionsAllowed: context.actor.recentMfa,
        },
      },
    };
  }
}
