import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";

const policyActionPattern = /^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)+$/;

export const selfServicePolicyActions = {
  currentSessionRead: "account:session:read",
  profileRead: "account:profile:read",
  profileUpdate: "account:profile:update",
  listingsRead: "account:listings:read",
  notificationsRead: "notification:read",
  notificationsUpdate: "notification:update",
  sessionsRead: "account:sessions:read",
  sessionsRevoke: "account:sessions:revoke",
} as const;

export const activeUserPolicyActions = {
  listingDraftCreate: "listing:draft:create",
  listingDraftUpdate: "listing:draft:update",
  listingArchive: "listing:archive",
  listingBatchManage: "listing:batch:manage",
  listingDelete: "listing:delete",
  listingSubmit: "listing:submit",
  mediaUploadComplete: "media:upload:complete",
  mediaUploadCreate: "media:upload:create",
  moderationAppealCreate: "moderation:appeal:create",
  mfaManage: "account:mfa:manage",
  organizationCreate: "organization:create",
  organizationInvitationAccept: "organization:invitation:accept",
  reportCreate: "moderation:report:create",
} as const;

export const listingObjectPolicyActions = {
  draftRead: "listing:draft:read",
  draftWrite: "listing:draft:write",
  lifecycleWrite: "listing:lifecycle:write",
  submit: "listing:submit:owned",
} as const;

export const adminPolicyActions = {
  consoleAccess: "admin:console:access",
  privilegedAccess: "admin:console:privileged",
  sensitiveAccess: "admin:sensitive:access",
  moderationRead: "admin:moderation:read",
  moderationAct: "admin:moderation:act",
} as const;

export const organizationPolicyActions = {
  profileRead: "organization:profile:read",
  profileEditContent: "organization:profile:edit",
  profileManage: "organization:profile:manage",
  listingsWrite: "organization:listings:write",
  membersRead: "organization:members:read",
  membersManage: "organization:members:manage",
  ownerTransfer: "organization:owner:transfer",
  billingManage: "organization:billing:manage",
  analyticsRead: "organization:analytics:read",
} as const;

export const accountSelfServicePermissions = [
  selfServicePolicyActions.currentSessionRead,
  selfServicePolicyActions.profileRead,
  selfServicePolicyActions.profileUpdate,
  selfServicePolicyActions.listingsRead,
  selfServicePolicyActions.notificationsRead,
  selfServicePolicyActions.notificationsUpdate,
  selfServicePolicyActions.sessionsRead,
  selfServicePolicyActions.sessionsRevoke,
] as const;

export const activeUserPermissions = [
  ...accountSelfServicePermissions,
  activeUserPolicyActions.listingDraftCreate,
  activeUserPolicyActions.listingDraftUpdate,
  activeUserPolicyActions.listingArchive,
  activeUserPolicyActions.listingBatchManage,
  activeUserPolicyActions.listingDelete,
  activeUserPolicyActions.listingSubmit,
  activeUserPolicyActions.mediaUploadComplete,
  activeUserPolicyActions.mediaUploadCreate,
  activeUserPolicyActions.moderationAppealCreate,
  activeUserPolicyActions.mfaManage,
  activeUserPolicyActions.organizationCreate,
  activeUserPolicyActions.organizationInvitationAccept,
  activeUserPolicyActions.reportCreate,
] as const;

export type PolicyAction = string;

export type OrganizationActorMembership = {
  organizationId: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "BILLING" | "ANALYST";
};

export type GuestActor = {
  kind: "guest";
};

export type AuthenticatedActor = {
  kind: "authenticated";
  userId: string;
  sessionId: string;
  accountStatus: "ACTIVE" | "LIMITED" | "SUSPENDED" | "DELETED";
  verificationBadges: readonly string[];
  permissions: readonly string[];
  platformRoles: readonly (
    | "SUPPORT"
    | "MODERATOR"
    | "SENIOR_MODERATOR"
    | "AD_OPS"
    | "FINANCE"
    | "TAXONOMY_ADMIN"
    | "PLATFORM_ADMIN"
    | "READ_ONLY_AUDITOR"
  )[];
  authenticationStrength: "PRIMARY" | "MFA";
  mfaVerifiedAt: string | null;
  recentMfa: boolean;
  organizations: readonly OrganizationActorMembership[];
};

export type PolicyActor = GuestActor | AuthenticatedActor;

export type PolicyResourceContext = {
  type: string;
  id?: string;
  ownerUserId?: string | null;
  organizationId?: string | null;
  state?: string;
  deleted?: boolean;
};

export type PolicyRequestContext = {
  requestId: string;
  method: string;
  route: string;
  actor: PolicyActor;
};

export type PolicyEvaluationInput = {
  action: PolicyAction;
  context: PolicyRequestContext;
  resource?: PolicyResourceContext;
};

export type PolicyDenyReason =
  | "ACCOUNT_RESTRICTED"
  | "AUTHENTICATION_REQUIRED"
  | "INSUFFICIENT_PERMISSION"
  | "OBJECT_ACCESS_DENIED"
  | "POLICY_EVALUATION_FAILED"
  | "RESOURCE_UNAVAILABLE"
  | "UNKNOWN_ACTION";

export type PolicyDecision =
  { allowed: true; reason: "POLICY_ALLOWED" } | { allowed: false; reason: PolicyDenyReason };

export type PolicyRule = (input: PolicyEvaluationInput) => PolicyDecision | Promise<PolicyDecision>;

export type ObjectAccessPolicyOptions = {
  allowOwner?: boolean;
  organizationRoles?: readonly OrganizationActorMembership["role"][];
  allowLimitedAccount?: boolean;
};

export function allowPolicy(): PolicyDecision {
  return { allowed: true, reason: "POLICY_ALLOWED" };
}

export function denyPolicy(reason: PolicyDenyReason): PolicyDecision {
  return { allowed: false, reason };
}

export function assertPolicyAction(action: string): asserts action is PolicyAction {
  if (!policyActionPattern.test(action)) {
    throw new TypeError(`Invalid policy action: ${action}`);
  }
}

export function requireActorPermissionPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { actor } = input.context;
  if (actor.kind === "guest") return denyPolicy("AUTHENTICATION_REQUIRED");
  return actor.permissions.includes(input.action)
    ? allowPolicy()
    : denyPolicy("INSUFFICIENT_PERMISSION");
}

export function requireActiveActorPermissionPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { actor } = input.context;
  if (actor.kind === "guest") return denyPolicy("AUTHENTICATION_REQUIRED");
  if (actor.accountStatus !== "ACTIVE") return denyPolicy("ACCOUNT_RESTRICTED");
  return actor.permissions.includes(input.action)
    ? allowPolicy()
    : denyPolicy("INSUFFICIENT_PERMISSION");
}

export function requireMfaActorPermissionPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { actor } = input.context;
  if (actor.kind === "guest") return denyPolicy("AUTHENTICATION_REQUIRED");
  if (actor.accountStatus !== "ACTIVE") return denyPolicy("ACCOUNT_RESTRICTED");
  if (actor.authenticationStrength !== "MFA") {
    return denyPolicy("INSUFFICIENT_PERMISSION");
  }
  return actor.permissions.includes(adminPolicyActions.privilegedAccess)
    ? allowPolicy()
    : denyPolicy("INSUFFICIENT_PERMISSION");
}

export function requireRecentMfaActorPermissionPolicy(
  input: PolicyEvaluationInput,
): PolicyDecision {
  const mfa = requireMfaActorPermissionPolicy({
    ...input,
    action: adminPolicyActions.privilegedAccess,
  });
  if (!mfa.allowed) return mfa;
  const { actor } = input.context;
  if (actor.kind === "guest" || !actor.recentMfa) {
    return denyPolicy("INSUFFICIENT_PERMISSION");
  }
  return allowPolicy();
}

export function requireModeratorMfaPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const mfa = requireMfaActorPermissionPolicy({
    ...input,
    action: adminPolicyActions.privilegedAccess,
  });
  if (!mfa.allowed) return mfa;
  const { actor } = input.context;
  if (
    actor.kind === "guest" ||
    !actor.platformRoles.some((role) => role === "MODERATOR" || role === "SENIOR_MODERATOR")
  ) {
    return denyPolicy("INSUFFICIENT_PERMISSION");
  }
  return allowPolicy();
}

export function requireModeratorRecentMfaPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const moderator = requireModeratorMfaPolicy(input);
  if (!moderator.allowed) return moderator;
  const { actor } = input.context;
  return actor.kind === "authenticated" && actor.recentMfa
    ? allowPolicy()
    : denyPolicy("INSUFFICIENT_PERMISSION");
}

export function ownerOrOrganizationPolicy(options: ObjectAccessPolicyOptions): PolicyRule {
  const organizationRoles = new Set(options.organizationRoles ?? []);
  return (input) => {
    const { actor } = input.context;
    if (actor.kind === "guest") return denyPolicy("AUTHENTICATION_REQUIRED");
    if (actor.accountStatus === "LIMITED" && !options.allowLimitedAccount) {
      return denyPolicy("ACCOUNT_RESTRICTED");
    }

    const resource = input.resource;
    if (!resource || resource.deleted !== false) return denyPolicy("RESOURCE_UNAVAILABLE");
    if (options.allowOwner && resource.ownerUserId === actor.userId) return allowPolicy();

    if (resource.organizationId) {
      const membership = actor.organizations.find(
        (candidate) => candidate.organizationId === resource.organizationId,
      );
      if (membership && organizationRoles.has(membership.role)) return allowPolicy();
    }
    return denyPolicy("OBJECT_ACCESS_DENIED");
  };
}

export function organizationOwnerTransferPolicy(input: PolicyEvaluationInput): PolicyDecision {
  const { actor } = input.context;
  if (actor.kind === "guest") return denyPolicy("AUTHENTICATION_REQUIRED");
  if (actor.accountStatus !== "ACTIVE") return denyPolicy("ACCOUNT_RESTRICTED");
  const resource = input.resource;
  if (!resource || resource.deleted !== false || !resource.organizationId) {
    return denyPolicy("RESOURCE_UNAVAILABLE");
  }
  const ownsOrganization = actor.organizations.some(
    (membership) =>
      membership.organizationId === resource.organizationId && membership.role === "OWNER",
  );
  return ownsOrganization && actor.authenticationStrength === "MFA" && actor.recentMfa
    ? allowPolicy()
    : denyPolicy("OBJECT_ACCESS_DENIED");
}

@Injectable()
export class PolicyService {
  readonly #rules = new Map<PolicyAction, PolicyRule>();

  register(action: PolicyAction, rule: PolicyRule): void {
    assertPolicyAction(action);
    if (this.#rules.has(action)) {
      throw new Error(`Policy action already registered: ${action}`);
    }
    this.#rules.set(action, rule);
  }

  registeredActions(): readonly PolicyAction[] {
    return [...this.#rules.keys()].sort();
  }

  async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    const rule = this.#rules.get(input.action);
    if (!rule) return denyPolicy("UNKNOWN_ACTION");

    const { actor } = input.context;
    if (
      actor.kind === "authenticated" &&
      (actor.accountStatus === "SUSPENDED" || actor.accountStatus === "DELETED")
    ) {
      return denyPolicy("ACCOUNT_RESTRICTED");
    }

    try {
      return await rule(input);
    } catch {
      return denyPolicy("POLICY_EVALUATION_FAILED");
    }
  }

  async require(input: PolicyEvaluationInput): Promise<void> {
    const decision = await this.evaluate(input);
    if (decision.allowed) return;
    if (decision.reason === "AUTHENTICATION_REQUIRED") {
      throw new UnauthorizedException("Authentication required");
    }
    throw new ForbiddenException("Access denied");
  }
}
