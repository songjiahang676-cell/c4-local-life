import { PrismaPg } from "@prisma/adapter-pg";
import {
  MembershipRole,
  OrganizationInvitationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
  type OrganizationType,
  type VerificationStatus,
} from "../../generated/prisma/client";

export type OrganizationRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type OrganizationProjection = {
  id: string;
  type: OrganizationType;
  legalName: string | null;
  displayName: string;
  slug: string;
  status: Exclude<UserStatus, "DELETED">;
  verificationStatus: VerificationStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type MemberOrganizationProjection = OrganizationProjection & {
  role: MembershipRole;
};

export type OrganizationMemberProjection = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: MembershipRole;
  joinedAt: Date;
  updatedAt: Date;
  version: number;
};

export type OrganizationMemberCursor = {
  userId: string;
  joinedAt: Date;
};

export type CreateOwnedOrganizationInput = {
  ownerUserId: string;
  type: Exclude<OrganizationType, "INTERNAL">;
  displayName: string;
  legalName?: string | null;
  slug: string;
};

export type CreateOwnedOrganizationResult =
  | { kind: "created" | "existing"; organization: MemberOrganizationProjection }
  | { kind: "slug_conflict" }
  | { kind: "actor_unavailable" };

export type ListOrganizationMembersInput = {
  actorUserId: string;
  organizationId: string;
  limit: number;
  cursor?: OrganizationMemberCursor;
};

export type OrganizationMemberPage = {
  items: OrganizationMemberProjection[];
  nextCursor: OrganizationMemberCursor | null;
};

export type OrganizationInvitationProjection = {
  id: string;
  organizationId: string;
  organizationDisplayName: string;
  inviteeUserId: string;
  role: Exclude<MembershipRole, "OWNER">;
  status: OrganizationInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateOrganizationInvitationInput = {
  actorUserId: string;
  organizationId: string;
  inviteeUserId: string;
  role: Exclude<MembershipRole, "OWNER">;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  now: Date;
  expiresAt: Date;
};

export type CreateOrganizationInvitationResult =
  | { kind: "created" | "existing"; invitation: OrganizationInvitationProjection }
  | {
      kind:
        | "actor_forbidden"
        | "already_member"
        | "idempotency_conflict"
        | "invitee_unavailable"
        | "pending_conflict";
    };

export type AcceptOrganizationInvitationInput = {
  actorUserId: string;
  invitationId: string;
  requestId: string;
  now: Date;
};

export type AcceptOrganizationInvitationResult =
  | { kind: "accepted" | "existing"; invitation: OrganizationInvitationProjection }
  | { kind: "expired" | "member_conflict" | "not_found" };

export type RevokeOrganizationInvitationInput = {
  actorUserId: string;
  organizationId: string;
  invitationId: string;
  requestId: string;
  now: Date;
};

export type RevokeOrganizationInvitationResult =
  | { kind: "revoked" | "existing"; invitation: OrganizationInvitationProjection }
  | { kind: "conflict" | "not_found" };

export type ChangeOrganizationMemberRoleInput = {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
  role: Exclude<MembershipRole, "OWNER">;
  expectedVersion: number;
  requestId: string;
  now: Date;
};

export type ChangeOrganizationMemberRoleResult =
  { kind: "updated"; member: OrganizationMemberProjection } | { kind: "conflict" | "not_found" };

export type RemoveOrganizationMemberInput = {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
  expectedVersion: number;
  requestId: string;
  now: Date;
};

export type RemoveOrganizationMemberResult = { kind: "removed" | "conflict" | "not_found" };

export type TransferOrganizationOwnershipInput = {
  actorUserId: string;
  organizationId: string;
  targetUserId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  now: Date;
};

export type OrganizationOwnerTransferProjection = {
  id: string;
  organizationId: string;
  fromUserId: string;
  toUserId: string;
  fromRoleAfter: "ADMIN";
  toRoleAfter: "OWNER";
  occurredAt: Date;
};

export type TransferOrganizationOwnershipResult =
  | { kind: "transferred" | "existing"; transfer: OrganizationOwnerTransferProjection }
  | { kind: "idempotency_conflict" | "not_found" };

type OrganizationClient = PrismaClient | Prisma.TransactionClient;

const organizationSelect = {
  id: true,
  type: true,
  legalName: true,
  displayName: true,
  slug: true,
  status: true,
  verificationStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

type SelectedOrganization = Prisma.OrganizationGetPayload<{ select: typeof organizationSelect }>;

const invitationSelect = {
  id: true,
  organizationId: true,
  inviteeUserId: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { displayName: true } },
} satisfies Prisma.OrganizationInvitationSelect;

type SelectedInvitation = Prisma.OrganizationInvitationGetPayload<{
  select: typeof invitationSelect;
}>;

const memberSelect = {
  userId: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  user: {
    select: {
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  },
} satisfies Prisma.OrganizationMembershipSelect;

type SelectedMember = Prisma.OrganizationMembershipGetPayload<{ select: typeof memberSelect }>;

function isRepositoryOptions(
  target: OrganizationClient | OrganizationRepositoryOptions,
): target is OrganizationRepositoryOptions {
  return "connectionString" in target;
}

function mapOrganization(row: SelectedOrganization): OrganizationProjection | null {
  if (row.status === UserStatus.DELETED) return null;
  return {
    id: row.id,
    type: row.type,
    legalName: row.legalName,
    displayName: row.displayName,
    slug: row.slug,
    status: row.status,
    verificationStatus: row.verificationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapInvitation(row: SelectedInvitation): OrganizationInvitationProjection {
  if (row.role === MembershipRole.OWNER) {
    throw new Error("Stored organization invitation role is invalid");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationDisplayName: row.organization.displayName,
    inviteeUserId: row.inviteeUserId,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMember(row: SelectedMember): OrganizationMemberProjection | null {
  if (!row.user.profile) return null;
  return {
    userId: row.userId,
    displayName: row.user.profile.displayName,
    avatarUrl: row.user.profile.avatarUrl,
    role: row.role,
    joinedAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function mapOwnerTransfer(row: {
  id: string;
  organizationId: string;
  fromUserId: string;
  toUserId: string;
  fromRoleAfter: MembershipRole;
  toRoleAfter: MembershipRole;
  occurredAt: Date;
}): OrganizationOwnerTransferProjection {
  if (row.fromRoleAfter !== MembershipRole.ADMIN || row.toRoleAfter !== MembershipRole.OWNER) {
    throw new Error("Stored organization Owner transfer is invalid");
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    fromRoleAfter: "ADMIN",
    toRoleAfter: "OWNER",
    occurredAt: row.occurredAt,
  };
}

function exactCreateRetry(
  organization: MemberOrganizationProjection,
  input: CreateOwnedOrganizationInput,
): boolean {
  return (
    organization.role === MembershipRole.OWNER &&
    organization.type === input.type &&
    organization.displayName === input.displayName &&
    organization.legalName === (input.legalName ?? null) &&
    organization.slug === input.slug
  );
}

async function lockActiveOrganization(
  transaction: Prisma.TransactionClient,
  organizationId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT "id"
      FROM "organizations"
      WHERE "id" = ${organizationId}::uuid
        AND "deleted_at" IS NULL
        AND "status" = 'ACTIVE'::"UserStatus"
      FOR UPDATE
    `,
  );
  return rows.length === 1;
}

async function currentManagerRole(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  organizationId: string,
): Promise<MembershipRole | null> {
  const membership = await transaction.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: actorUserId,
      },
    },
    select: {
      role: true,
      user: { select: { status: true, deletedAt: true } },
    },
  });
  if (
    !membership ||
    membership.user.status !== UserStatus.ACTIVE ||
    membership.user.deletedAt ||
    (membership.role !== MembershipRole.OWNER && membership.role !== MembershipRole.ADMIN)
  ) {
    return null;
  }
  return membership.role;
}

async function appendOrganizationEvidence(
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    requestId: string;
    action: string;
    targetType: string;
    targetId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Prisma.InputJsonObject;
    metadata: Prisma.InputJsonObject;
    now: Date;
  },
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      actorId: input.actorUserId,
      actorType: "USER",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      metadata: input.metadata,
      createdAt: input.now,
    },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      availableAt: input.now,
      createdAt: input.now,
    },
  });
}

export class OrganizationRepository {
  readonly #client: OrganizationClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: OrganizationClient | OrganizationRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  async createOwned(input: CreateOwnedOrganizationInput): Promise<CreateOwnedOrganizationResult> {
    const existing = await this.#memberOrganizationBySlug(input.ownerUserId, input.slug);
    if (existing) {
      return exactCreateRetry(existing, input)
        ? { kind: "existing", organization: existing }
        : { kind: "slug_conflict" };
    }

    try {
      return await this.#transaction(async (transaction) => {
        const actor = await transaction.user.findFirst({
          where: {
            id: input.ownerUserId,
            status: UserStatus.ACTIVE,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!actor) return { kind: "actor_unavailable" } as const;

        const created = await transaction.organization.create({
          data: {
            type: input.type,
            displayName: input.displayName,
            legalName: input.legalName ?? null,
            slug: input.slug,
            memberships: {
              create: {
                userId: actor.id,
                role: MembershipRole.OWNER,
              },
            },
          },
          select: organizationSelect,
        });
        const organization = mapOrganization(created);
        if (!organization) return { kind: "actor_unavailable" } as const;
        return {
          kind: "created",
          organization: { ...organization, role: MembershipRole.OWNER },
        } as const;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        if (this.#ownedClient) {
          const concurrentExisting = await this.#memberOrganizationBySlug(
            input.ownerUserId,
            input.slug,
          );
          if (concurrentExisting && exactCreateRetry(concurrentExisting, input)) {
            return { kind: "existing", organization: concurrentExisting };
          }
        }
        return { kind: "slug_conflict" };
      }
      throw error;
    }
  }

  async findByIdForMember(
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection | null> {
    const membership = await this.#client.organizationMembership.findFirst({
      where: {
        organizationId,
        userId: actorUserId,
        organization: {
          deletedAt: null,
          status: { not: UserStatus.DELETED },
        },
      },
      select: {
        role: true,
        organization: { select: organizationSelect },
      },
    });
    if (!membership) return null;
    const organization = mapOrganization(membership.organization);
    return organization ? { ...organization, role: membership.role } : null;
  }

  async listMembers(input: ListOrganizationMembersInput): Promise<OrganizationMemberPage> {
    const rows = await this.#client.organizationMembership.findMany({
      where: {
        organizationId: input.organizationId,
        organization: {
          deletedAt: null,
          status: { not: UserStatus.DELETED },
          memberships: {
            some: {
              userId: input.actorUserId,
              role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] },
            },
          },
        },
        user: {
          deletedAt: null,
          profile: { isNot: null },
        },
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.joinedAt } },
                {
                  createdAt: input.cursor.joinedAt,
                  userId: { lt: input.cursor.userId },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { userId: "desc" }],
      take: input.limit + 1,
      select: memberSelect,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.flatMap((row) => {
      const member = mapMember(row);
      return member ? [member] : [];
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? {
              userId: last.userId,
              joinedAt: last.createdAt,
            }
          : null,
    };
  }

  createInvitation(
    input: CreateOrganizationInvitationInput,
  ): Promise<CreateOrganizationInvitationResult> {
    return this.#transaction(async (transaction) => {
      if (!(await lockActiveOrganization(transaction, input.organizationId))) {
        return { kind: "actor_forbidden" };
      }
      const managerRole = await currentManagerRole(
        transaction,
        input.actorUserId,
        input.organizationId,
      );
      if (!managerRole || input.actorUserId === input.inviteeUserId) {
        return { kind: "actor_forbidden" };
      }

      const retry = await transaction.organizationInvitation.findFirst({
        where: {
          organizationId: input.organizationId,
          invitedById: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        select: { ...invitationSelect, requestHash: true },
      });
      if (retry) {
        return retry.requestHash === input.requestHash
          ? { kind: "existing", invitation: mapInvitation(retry) }
          : { kind: "idempotency_conflict" };
      }

      const invitee = await transaction.user.findFirst({
        where: {
          id: input.inviteeUserId,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          profile: { isNot: null },
        },
        select: { id: true },
      });
      if (!invitee) return { kind: "invitee_unavailable" };

      const membership = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.inviteeUserId,
          },
        },
        select: { userId: true },
      });
      if (membership) return { kind: "already_member" };

      await transaction.organizationInvitation.updateMany({
        where: {
          organizationId: input.organizationId,
          inviteeUserId: input.inviteeUserId,
          status: OrganizationInvitationStatus.PENDING,
          expiresAt: { lte: input.now },
        },
        data: {
          status: OrganizationInvitationStatus.EXPIRED,
          updatedAt: input.now,
        },
      });
      const pending = await transaction.organizationInvitation.findFirst({
        where: {
          organizationId: input.organizationId,
          inviteeUserId: input.inviteeUserId,
          status: OrganizationInvitationStatus.PENDING,
        },
        select: { id: true },
      });
      if (pending) return { kind: "pending_conflict" };

      const invitation = await transaction.organizationInvitation.create({
        data: {
          organizationId: input.organizationId,
          inviteeUserId: input.inviteeUserId,
          invitedById: input.actorUserId,
          role: input.role,
          status: OrganizationInvitationStatus.PENDING,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          expiresAt: input.expiresAt,
          createdAt: input.now,
          updatedAt: input.now,
        },
        select: invitationSelect,
      });
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.invitation.created",
        targetType: "ORGANIZATION_INVITATION",
        targetId: invitation.id,
        aggregateType: "ORGANIZATION_INVITATION",
        aggregateId: invitation.id,
        eventType: "organization.invitation.created",
        payload: {
          schemaVersion: 1,
          invitationId: invitation.id,
          aggregateVersion: 1,
        },
        metadata: {
          organizationId: input.organizationId,
          inviteeUserId: input.inviteeUserId,
          role: input.role,
        },
        now: input.now,
      });
      return { kind: "created", invitation: mapInvitation(invitation) };
    });
  }

  acceptInvitation(
    input: AcceptOrganizationInvitationInput,
  ): Promise<AcceptOrganizationInvitationResult> {
    return this.#transaction(async (transaction) => {
      const candidate = await transaction.organizationInvitation.findFirst({
        where: {
          id: input.invitationId,
          inviteeUserId: input.actorUserId,
        },
        select: { organizationId: true },
      });
      if (!candidate || !(await lockActiveOrganization(transaction, candidate.organizationId))) {
        return { kind: "not_found" };
      }
      const locked = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT "id"
          FROM "organization_invitations"
          WHERE "id" = ${input.invitationId}::uuid
            AND "invitee_user_id" = ${input.actorUserId}::uuid
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return { kind: "not_found" };
      const invitation = await transaction.organizationInvitation.findFirst({
        where: {
          id: input.invitationId,
          inviteeUserId: input.actorUserId,
        },
        select: invitationSelect,
      });
      if (!invitation) return { kind: "not_found" };
      if (invitation.status === OrganizationInvitationStatus.ACCEPTED) {
        return { kind: "existing", invitation: mapInvitation(invitation) };
      }
      if (
        invitation.status === OrganizationInvitationStatus.EXPIRED ||
        invitation.expiresAt <= input.now
      ) {
        if (invitation.status === OrganizationInvitationStatus.PENDING) {
          await transaction.organizationInvitation.update({
            where: { id: invitation.id },
            data: {
              status: OrganizationInvitationStatus.EXPIRED,
              updatedAt: input.now,
            },
          });
        }
        return { kind: "expired" };
      }
      if (invitation.status !== OrganizationInvitationStatus.PENDING) {
        return { kind: "not_found" };
      }
      const actor = await transaction.user.findFirst({
        where: {
          id: input.actorUserId,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          profile: { isNot: null },
        },
        select: { id: true },
      });
      if (!actor) return { kind: "not_found" };
      const existingMember = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: input.actorUserId,
          },
        },
        select: { userId: true },
      });
      if (existingMember) return { kind: "member_conflict" };

      await transaction.organizationMembership.create({
        data: {
          organizationId: invitation.organizationId,
          userId: input.actorUserId,
          role: invitation.role,
          createdAt: input.now,
          updatedAt: input.now,
          version: 1,
        },
      });
      const accepted = await transaction.organizationInvitation.update({
        where: { id: invitation.id },
        data: {
          status: OrganizationInvitationStatus.ACCEPTED,
          acceptedAt: input.now,
          updatedAt: input.now,
        },
        select: invitationSelect,
      });
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.invitation.accepted",
        targetType: "ORGANIZATION_INVITATION",
        targetId: accepted.id,
        aggregateType: "ORGANIZATION_INVITATION",
        aggregateId: accepted.id,
        eventType: "organization.invitation.accepted",
        payload: {
          schemaVersion: 1,
          invitationId: accepted.id,
          organizationId: accepted.organizationId,
          aggregateVersion: 2,
        },
        metadata: {
          organizationId: accepted.organizationId,
          role: accepted.role,
        },
        now: input.now,
      });
      return { kind: "accepted", invitation: mapInvitation(accepted) };
    });
  }

  revokeInvitation(
    input: RevokeOrganizationInvitationInput,
  ): Promise<RevokeOrganizationInvitationResult> {
    return this.#transaction(async (transaction) => {
      if (!(await lockActiveOrganization(transaction, input.organizationId))) {
        return { kind: "not_found" };
      }
      const managerRole = await currentManagerRole(
        transaction,
        input.actorUserId,
        input.organizationId,
      );
      if (!managerRole) return { kind: "not_found" };
      const locked = await transaction.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT "id"
          FROM "organization_invitations"
          WHERE "id" = ${input.invitationId}::uuid
            AND "organization_id" = ${input.organizationId}::uuid
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return { kind: "not_found" };
      const invitation = await transaction.organizationInvitation.findFirst({
        where: {
          id: input.invitationId,
          organizationId: input.organizationId,
        },
        select: invitationSelect,
      });
      if (!invitation) return { kind: "not_found" };
      if (invitation.status === OrganizationInvitationStatus.REVOKED) {
        return { kind: "existing", invitation: mapInvitation(invitation) };
      }
      if (
        invitation.status === OrganizationInvitationStatus.PENDING &&
        invitation.expiresAt <= input.now
      ) {
        await transaction.organizationInvitation.update({
          where: { id: invitation.id },
          data: {
            status: OrganizationInvitationStatus.EXPIRED,
            updatedAt: input.now,
          },
        });
        return { kind: "conflict" };
      }
      if (invitation.status !== OrganizationInvitationStatus.PENDING) {
        return { kind: "conflict" };
      }
      const revoked = await transaction.organizationInvitation.update({
        where: { id: invitation.id },
        data: {
          status: OrganizationInvitationStatus.REVOKED,
          revokedById: input.actorUserId,
          revokedAt: input.now,
          updatedAt: input.now,
        },
        select: invitationSelect,
      });
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.invitation.revoked",
        targetType: "ORGANIZATION_INVITATION",
        targetId: revoked.id,
        aggregateType: "ORGANIZATION_INVITATION",
        aggregateId: revoked.id,
        eventType: "organization.invitation.revoked",
        payload: {
          schemaVersion: 1,
          invitationId: revoked.id,
          organizationId: revoked.organizationId,
          aggregateVersion: 2,
        },
        metadata: {
          organizationId: revoked.organizationId,
          role: revoked.role,
        },
        now: input.now,
      });
      return { kind: "revoked", invitation: mapInvitation(revoked) };
    });
  }

  changeMemberRole(
    input: ChangeOrganizationMemberRoleInput,
  ): Promise<ChangeOrganizationMemberRoleResult> {
    return this.#transaction(async (transaction) => {
      if (
        input.actorUserId === input.targetUserId ||
        !(await lockActiveOrganization(transaction, input.organizationId))
      ) {
        return { kind: "not_found" };
      }
      const managerRole = await currentManagerRole(
        transaction,
        input.actorUserId,
        input.organizationId,
      );
      if (!managerRole) return { kind: "not_found" };
      const target = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.targetUserId,
          },
        },
        select: memberSelect,
      });
      if (!target || target.role === MembershipRole.OWNER || !mapMember(target)) {
        return { kind: "not_found" };
      }
      if (target.version !== input.expectedVersion) return { kind: "conflict" };
      const changed = await transaction.organizationMembership.updateMany({
        where: {
          organizationId: input.organizationId,
          userId: input.targetUserId,
          version: input.expectedVersion,
          role: { not: MembershipRole.OWNER },
        },
        data: {
          role: input.role,
          version: { increment: 1 },
          updatedAt: input.now,
        },
      });
      if (changed.count !== 1) return { kind: "conflict" };
      const updated = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.targetUserId,
          },
        },
        select: memberSelect,
      });
      const member = updated ? mapMember(updated) : null;
      if (!member) return { kind: "not_found" };
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.member.role.changed",
        targetType: "ORGANIZATION_MEMBERSHIP",
        targetId: input.targetUserId,
        aggregateType: "ORGANIZATION",
        aggregateId: input.organizationId,
        eventType: "organization.member.role.changed",
        payload: {
          schemaVersion: 1,
          organizationId: input.organizationId,
          memberUserId: input.targetUserId,
          aggregateVersion: member.version,
        },
        metadata: {
          organizationId: input.organizationId,
          previousRole: target.role,
          currentRole: member.role,
          version: member.version,
        },
        now: input.now,
      });
      return { kind: "updated", member };
    });
  }

  removeMember(input: RemoveOrganizationMemberInput): Promise<RemoveOrganizationMemberResult> {
    return this.#transaction(async (transaction) => {
      if (
        input.actorUserId === input.targetUserId ||
        !(await lockActiveOrganization(transaction, input.organizationId))
      ) {
        return { kind: "not_found" };
      }
      const managerRole = await currentManagerRole(
        transaction,
        input.actorUserId,
        input.organizationId,
      );
      if (!managerRole) return { kind: "not_found" };
      const target = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.targetUserId,
          },
        },
        select: { role: true, version: true },
      });
      if (!target || target.role === MembershipRole.OWNER) return { kind: "not_found" };
      if (target.version !== input.expectedVersion) return { kind: "conflict" };
      const removed = await transaction.organizationMembership.deleteMany({
        where: {
          organizationId: input.organizationId,
          userId: input.targetUserId,
          role: { not: MembershipRole.OWNER },
          version: input.expectedVersion,
        },
      });
      if (removed.count !== 1) return { kind: "conflict" };
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.membership.removed",
        targetType: "ORGANIZATION_MEMBERSHIP",
        targetId: input.targetUserId,
        aggregateType: "ORGANIZATION",
        aggregateId: input.organizationId,
        eventType: "organization.membership.removed",
        payload: {
          schemaVersion: 1,
          organizationId: input.organizationId,
          memberUserId: input.targetUserId,
          aggregateVersion: target.version + 1,
        },
        metadata: {
          organizationId: input.organizationId,
          previousRole: target.role,
        },
        now: input.now,
      });
      return { kind: "removed" };
    });
  }

  transferOwnership(
    input: TransferOrganizationOwnershipInput,
  ): Promise<TransferOrganizationOwnershipResult> {
    return this.#transaction(async (transaction) => {
      if (
        input.actorUserId === input.targetUserId ||
        !(await lockActiveOrganization(transaction, input.organizationId))
      ) {
        return { kind: "not_found" };
      }
      const receipt = await transaction.organizationOwnerTransfer.findFirst({
        where: {
          organizationId: input.organizationId,
          fromUserId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        select: {
          id: true,
          organizationId: true,
          fromUserId: true,
          toUserId: true,
          requestHash: true,
          fromRoleAfter: true,
          toRoleAfter: true,
          occurredAt: true,
        },
      });
      if (receipt) {
        return receipt.requestHash === input.requestHash
          ? { kind: "existing", transfer: mapOwnerTransfer(receipt) }
          : { kind: "idempotency_conflict" };
      }
      const managerRole = await currentManagerRole(
        transaction,
        input.actorUserId,
        input.organizationId,
      );
      if (managerRole !== MembershipRole.OWNER) return { kind: "not_found" };
      const target = await transaction.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.targetUserId,
          },
        },
        select: {
          role: true,
          user: { select: { status: true, deletedAt: true } },
        },
      });
      if (
        !target ||
        target.role === MembershipRole.OWNER ||
        target.user.status !== UserStatus.ACTIVE ||
        target.user.deletedAt
      ) {
        return { kind: "not_found" };
      }

      await transaction.organizationMembership.update({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.targetUserId,
          },
        },
        data: {
          role: MembershipRole.OWNER,
          version: { increment: 1 },
          updatedAt: input.now,
        },
      });
      await transaction.organizationMembership.update({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.actorUserId,
          },
        },
        data: {
          role: MembershipRole.ADMIN,
          version: { increment: 1 },
          updatedAt: input.now,
        },
      });
      const created = await transaction.organizationOwnerTransfer.create({
        data: {
          organizationId: input.organizationId,
          fromUserId: input.actorUserId,
          toUserId: input.targetUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          fromRoleAfter: MembershipRole.ADMIN,
          toRoleAfter: MembershipRole.OWNER,
          occurredAt: input.now,
        },
        select: {
          id: true,
          organizationId: true,
          fromUserId: true,
          toUserId: true,
          fromRoleAfter: true,
          toRoleAfter: true,
          occurredAt: true,
        },
      });
      await appendOrganizationEvidence(transaction, {
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        action: "organization.owner.transferred",
        targetType: "ORGANIZATION",
        targetId: input.organizationId,
        aggregateType: "ORGANIZATION",
        aggregateId: input.organizationId,
        eventType: "organization.owner.transferred",
        payload: {
          schemaVersion: 1,
          organizationId: input.organizationId,
          fromUserId: input.actorUserId,
          toUserId: input.targetUserId,
          aggregateVersion: 1,
        },
        metadata: {
          fromUserId: input.actorUserId,
          toUserId: input.targetUserId,
          fromRoleAfter: "ADMIN",
          toRoleAfter: "OWNER",
        },
        now: input.now,
      });
      return { kind: "transferred", transfer: mapOwnerTransfer(created) };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  async #memberOrganizationBySlug(
    actorUserId: string,
    slug: string,
  ): Promise<MemberOrganizationProjection | null> {
    const membership = await this.#client.organizationMembership.findFirst({
      where: {
        userId: actorUserId,
        organization: {
          slug,
          deletedAt: null,
          status: { not: UserStatus.DELETED },
        },
      },
      select: {
        role: true,
        organization: { select: organizationSelect },
      },
    });
    if (!membership) return null;
    const organization = mapOrganization(membership.organization);
    return organization ? { ...organization, role: membership.role } : null;
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) return this.#client.$transaction(callback);
    return callback(this.#client);
  }
}
