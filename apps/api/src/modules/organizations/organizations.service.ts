import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  ChangeOrganizationMemberRoleRequest,
  CreateOrganizationRequest,
  CreateOrganizationInvitationRequest,
  ListOrganizationMembersQuery,
  Organization,
  OrganizationInvitationResponse,
  OrganizationMemberCollection,
  OrganizationMemberResponse,
  OrganizationOwnerTransferResponse,
  TransferOrganizationOwnershipRequest,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  activeUserPolicyActions,
  organizationPolicyActions,
  PolicyService,
  type PolicyResourceContext,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import {
  ORGANIZATION_STORE,
  type MemberOrganizationProjection,
  type OrganizationInvitationProjection,
  type OrganizationMemberPage,
  type OrganizationStore,
} from "./organization.store";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("Organization not found");
    this.name = "OrganizationNotFoundError";
  }
}

export class OrganizationSlugConflictError extends Error {
  constructor() {
    super("Organization slug is unavailable");
    this.name = "OrganizationSlugConflictError";
  }
}

export class OrganizationActorUnavailableError extends Error {
  constructor() {
    super("Organization actor is unavailable");
    this.name = "OrganizationActorUnavailableError";
  }
}

export class InvalidOrganizationMemberCursorError extends Error {
  constructor() {
    super("Organization member cursor is invalid");
    this.name = "InvalidOrganizationMemberCursorError";
  }
}

export class OrganizationInvitationConflictError extends Error {
  constructor() {
    super("Organization invitation conflicts with current state");
    this.name = "OrganizationInvitationConflictError";
  }
}

export class OrganizationInvitationExpiredError extends Error {
  constructor() {
    super("Organization invitation has expired");
    this.name = "OrganizationInvitationExpiredError";
  }
}

export class OrganizationMemberConflictError extends Error {
  constructor() {
    super("Organization member version or state conflicts");
    this.name = "OrganizationMemberConflictError";
  }
}

type MemberCursorPayload = {
  version: 1;
  actorUserId: string;
  organizationId: string;
  joinedAt: string;
  userId: string;
};

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-organization-member-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

function toOrganization(organization: MemberOrganizationProjection): Organization {
  return {
    id: organization.id,
    type: organization.type,
    displayName: organization.displayName,
    legalName: organization.legalName,
    slug: organization.slug,
    status: organization.status,
    verificationStatus: organization.verificationStatus,
    role: organization.role,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

function authenticatedUserId(context: PolicyRequestContext): string {
  if (context.actor.kind === "guest") {
    throw new UnauthorizedException("Authentication required");
  }
  return context.actor.userId;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function organizationResource(organization: MemberOrganizationProjection): PolicyResourceContext {
  return {
    type: "organization",
    id: organization.id,
    organizationId: organization.id,
    state: organization.status,
    deleted: false,
  };
}

function toMember(
  member: OrganizationMemberPage["items"][number],
): OrganizationMemberResponse["data"] {
  return {
    userId: member.userId,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    version: member.version,
  };
}

function toInvitation(
  invitation: OrganizationInvitationProjection,
): OrganizationInvitationResponse {
  return {
    data: {
      ...invitation,
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      revokedAt: invitation.revokedAt?.toISOString() ?? null,
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
    },
  };
}

export function organizationMemberEtag(version: number): string {
  return `"organization-member-${version}"`;
}

export function organizationMemberVersionFromEtag(value: string | undefined): number | null {
  const match = /^"organization-member-([1-9][0-9]*)"$/.exec(value ?? "");
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function withCurrentMembership(
  context: PolicyRequestContext,
  organization: MemberOrganizationProjection,
): PolicyRequestContext {
  if (context.actor.kind === "guest") return context;
  const organizations = context.actor.organizations.filter(
    (membership) => membership.organizationId !== organization.id,
  );
  organizations.push({
    organizationId: organization.id,
    role: organization.role,
  });
  return Object.freeze({
    ...context,
    actor: Object.freeze({
      ...context.actor,
      organizations: Object.freeze(organizations),
    }),
  });
}

@Injectable()
export class OrganizationsService {
  readonly #cursorSecret: string;
  readonly #invitationTtlSeconds: number;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(ORGANIZATION_STORE) private readonly store: OrganizationStore,
    private readonly policies: PolicyService,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
    this.#invitationTtlSeconds = environment.ORGANIZATION_INVITATION_TTL_SECONDS;
  }

  async create(
    context: PolicyRequestContext,
    input: CreateOrganizationRequest,
  ): Promise<Organization> {
    await this.policies.require({
      action: activeUserPolicyActions.organizationCreate,
      context,
    });
    const ownerUserId = authenticatedUserId(context);
    const result = await this.store.createOwned({
      ownerUserId,
      type: input.type,
      displayName: input.displayName,
      legalName: input.legalName ?? null,
      slug: input.slug,
    });
    if (result.kind === "slug_conflict") throw new OrganizationSlugConflictError();
    if (result.kind === "actor_unavailable") throw new OrganizationActorUnavailableError();
    return toOrganization(result.organization);
  }

  async get(context: PolicyRequestContext, organizationId: string): Promise<Organization> {
    const actorUserId = authenticatedUserId(context);
    const organization = await this.store.findByIdForMember(actorUserId, organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    await this.policies.require({
      action: organizationPolicyActions.profileRead,
      context: withCurrentMembership(context, organization),
      resource: organizationResource(organization),
    });
    return toOrganization(organization);
  }

  async listMembers(
    context: PolicyRequestContext,
    organizationId: string,
    query: ListOrganizationMembersQuery,
  ): Promise<OrganizationMemberCollection> {
    const actorUserId = authenticatedUserId(context);
    const organization = await this.store.findByIdForMember(actorUserId, organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    await this.policies.require({
      action: organizationPolicyActions.membersRead,
      context: withCurrentMembership(context, organization),
      resource: organizationResource(organization),
    });
    const cursor = query.cursor
      ? this.#decodeCursor(query.cursor, actorUserId, organizationId)
      : undefined;
    const page = await this.store.listMembers({
      actorUserId,
      organizationId,
      limit: query.limit ?? 20,
      ...(cursor ? { cursor } : {}),
    });
    return {
      data: page.items.map(toMember),
      pageInfo: {
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor
          ? this.#encodeCursor(actorUserId, organizationId, page.nextCursor)
          : null,
      },
    };
  }

  async createInvitation(
    context: PolicyRequestContext,
    organizationId: string,
    idempotencyKey: string,
    input: CreateOrganizationInvitationRequest,
  ): Promise<OrganizationInvitationResponse> {
    const actorUserId = authenticatedUserId(context);
    const organization = await this.#requireManagedOrganization(
      context,
      actorUserId,
      organizationId,
    );
    const now = new Date();
    const result = await this.store.createInvitation({
      actorUserId,
      organizationId: organization.id,
      inviteeUserId: input.inviteeUserId,
      role: input.role,
      idempotencyKey,
      requestHash: requestHash(input),
      requestId: context.requestId,
      now,
      expiresAt: new Date(now.getTime() + this.#invitationTtlSeconds * 1_000),
    });
    if (result.kind === "created" || result.kind === "existing") {
      return toInvitation(result.invitation);
    }
    if (result.kind === "actor_forbidden" || result.kind === "invitee_unavailable") {
      throw new OrganizationNotFoundError();
    }
    throw new OrganizationInvitationConflictError();
  }

  async acceptInvitation(
    context: PolicyRequestContext,
    invitationId: string,
  ): Promise<OrganizationInvitationResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.organizationInvitationAccept,
      context,
    });
    const result = await this.store.acceptInvitation({
      actorUserId: authenticatedUserId(context),
      invitationId,
      requestId: context.requestId,
      now: new Date(),
    });
    if (result.kind === "accepted" || result.kind === "existing") {
      return toInvitation(result.invitation);
    }
    if (result.kind === "expired") throw new OrganizationInvitationExpiredError();
    if (result.kind === "member_conflict") throw new OrganizationInvitationConflictError();
    throw new OrganizationNotFoundError();
  }

  async revokeInvitation(
    context: PolicyRequestContext,
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const actorUserId = authenticatedUserId(context);
    await this.#requireManagedOrganization(context, actorUserId, organizationId);
    const result = await this.store.revokeInvitation({
      actorUserId,
      organizationId,
      invitationId,
      requestId: context.requestId,
      now: new Date(),
    });
    if (result.kind === "revoked" || result.kind === "existing") return;
    if (result.kind === "conflict") throw new OrganizationInvitationConflictError();
    throw new OrganizationNotFoundError();
  }

  async changeMemberRole(
    context: PolicyRequestContext,
    organizationId: string,
    targetUserId: string,
    expectedVersion: number,
    input: ChangeOrganizationMemberRoleRequest,
  ): Promise<OrganizationMemberResponse> {
    const actorUserId = authenticatedUserId(context);
    await this.#requireManagedOrganization(context, actorUserId, organizationId);
    const result = await this.store.changeMemberRole({
      actorUserId,
      organizationId,
      targetUserId,
      role: input.role,
      expectedVersion,
      requestId: context.requestId,
      now: new Date(),
    });
    if (result.kind === "updated") return { data: toMember(result.member) };
    if (result.kind === "conflict") throw new OrganizationMemberConflictError();
    throw new OrganizationNotFoundError();
  }

  async removeMember(
    context: PolicyRequestContext,
    organizationId: string,
    targetUserId: string,
    expectedVersion: number,
  ): Promise<void> {
    const actorUserId = authenticatedUserId(context);
    await this.#requireManagedOrganization(context, actorUserId, organizationId);
    const result = await this.store.removeMember({
      actorUserId,
      organizationId,
      targetUserId,
      expectedVersion,
      requestId: context.requestId,
      now: new Date(),
    });
    if (result.kind === "removed") return;
    if (result.kind === "conflict") throw new OrganizationMemberConflictError();
    throw new OrganizationNotFoundError();
  }

  async transferOwnership(
    context: PolicyRequestContext,
    organizationId: string,
    idempotencyKey: string,
    input: TransferOrganizationOwnershipRequest,
  ): Promise<OrganizationOwnerTransferResponse> {
    const actorUserId = authenticatedUserId(context);
    const organization = await this.store.findByIdForMember(actorUserId, organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    const transferInput = {
      actorUserId,
      organizationId,
      targetUserId: input.targetUserId,
      idempotencyKey,
      requestHash: requestHash(input),
      requestId: context.requestId,
      now: new Date(),
    };
    if (organization.role !== "OWNER") {
      if (
        context.actor.kind !== "authenticated" ||
        context.actor.authenticationStrength !== "MFA" ||
        !context.actor.recentMfa
      ) {
        await this.policies.require({
          action: organizationPolicyActions.ownerTransfer,
          context: withCurrentMembership(context, organization),
          resource: organizationResource(organization),
        });
      }
      const retry = await this.store.transferOwnership(transferInput);
      if (retry.kind === "existing") {
        return {
          data: {
            ...retry.transfer,
            occurredAt: retry.transfer.occurredAt.toISOString(),
          },
        };
      }
      if (retry.kind === "idempotency_conflict") {
        throw new OrganizationInvitationConflictError();
      }
      throw new OrganizationNotFoundError();
    }
    await this.policies.require({
      action: organizationPolicyActions.ownerTransfer,
      context: withCurrentMembership(context, organization),
      resource: organizationResource(organization),
    });
    const result = await this.store.transferOwnership(transferInput);
    if (result.kind === "transferred" || result.kind === "existing") {
      return {
        data: {
          ...result.transfer,
          occurredAt: result.transfer.occurredAt.toISOString(),
        },
      };
    }
    if (result.kind === "idempotency_conflict") {
      throw new OrganizationInvitationConflictError();
    }
    throw new OrganizationNotFoundError();
  }

  async #requireManagedOrganization(
    context: PolicyRequestContext,
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection> {
    const organization = await this.store.findByIdForMember(actorUserId, organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    await this.policies.require({
      action: organizationPolicyActions.membersManage,
      context: withCurrentMembership(context, organization),
      resource: organizationResource(organization),
    });
    return organization;
  }

  #encodeCursor(
    actorUserId: string,
    organizationId: string,
    cursor: { joinedAt: Date; userId: string },
  ): string {
    const payload: MemberCursorPayload = {
      version: 1,
      actorUserId,
      organizationId,
      joinedAt: cursor.joinedAt.toISOString(),
      userId: cursor.userId,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${cursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodeCursor(
    value: string,
    actorUserId: string,
    organizationId: string,
  ): { joinedAt: Date; userId: string } {
    const parts = value.split(".");
    if (parts.length !== 2) throw new InvalidOrganizationMemberCursorError();
    const [encoded, providedSignature] = parts;
    if (
      !encoded ||
      !providedSignature ||
      !signaturesMatch(cursorSignature(this.#cursorSecret, encoded), providedSignature)
    ) {
      throw new InvalidOrganizationMemberCursorError();
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<MemberCursorPayload>;
      if (
        payload.version !== 1 ||
        payload.actorUserId !== actorUserId ||
        payload.organizationId !== organizationId ||
        typeof payload.joinedAt !== "string" ||
        typeof payload.userId !== "string" ||
        !uuidPattern.test(payload.userId)
      ) {
        throw new InvalidOrganizationMemberCursorError();
      }
      const joinedAt = new Date(payload.joinedAt);
      if (Number.isNaN(joinedAt.getTime()) || joinedAt.toISOString() !== payload.joinedAt) {
        throw new InvalidOrganizationMemberCursorError();
      }
      return { joinedAt, userId: payload.userId };
    } catch (error) {
      if (error instanceof InvalidOrganizationMemberCursorError) throw error;
      throw new InvalidOrganizationMemberCursorError();
    }
  }
}
