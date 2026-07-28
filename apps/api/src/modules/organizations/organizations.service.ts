import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  CreateOrganizationRequest,
  ListOrganizationMembersQuery,
  Organization,
  OrganizationMemberCollection,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  activeUserPolicyActions,
  organizationPolicyActions,
  PolicyService,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import {
  ORGANIZATION_STORE,
  type MemberOrganizationProjection,
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

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(ORGANIZATION_STORE) private readonly store: OrganizationStore,
    private readonly policies: PolicyService,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
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
      resource: {
        type: "organization",
        id: organization.id,
        organizationId: organization.id,
        state: organization.status,
        deleted: false,
      },
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
      resource: {
        type: "organization",
        id: organization.id,
        organizationId: organization.id,
        state: organization.status,
        deleted: false,
      },
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
      data: page.items.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      })),
      pageInfo: {
        hasMore: page.nextCursor !== null,
        nextCursor: page.nextCursor
          ? this.#encodeCursor(actorUserId, organizationId, page.nextCursor)
          : null,
      },
    };
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
