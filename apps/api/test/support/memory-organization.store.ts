import { randomUUID } from "node:crypto";
import type {
  AcceptOrganizationInvitationInput,
  AcceptOrganizationInvitationResult,
  ChangeOrganizationMemberRoleInput,
  ChangeOrganizationMemberRoleResult,
  CreateOrganizationInvitationInput,
  CreateOrganizationInvitationResult,
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationInvitationProjection,
  OrganizationMemberPage,
  OrganizationStore,
  RemoveOrganizationMemberInput,
  RemoveOrganizationMemberResult,
  RevokeOrganizationInvitationInput,
  RevokeOrganizationInvitationResult,
  TransferOrganizationOwnershipInput,
  TransferOrganizationOwnershipResult,
} from "../../src/modules/organizations/organization.store";

type StoredMember = OrganizationMemberPage["items"][number];

export class MemoryOrganizationStore implements OrganizationStore {
  readonly #organizations = new Map<string, MemberOrganizationProjection>();
  readonly #members = new Map<string, StoredMember[]>();
  readonly #activeUsers = new Set<string>();
  readonly #invitations = new Map<string, OrganizationInvitationProjection>();
  readonly #invitationIdempotency = new Map<
    string,
    { requestHash: string; invitationId: string }
  >();
  readonly #transfers = new Map<
    string,
    {
      requestHash: string;
      transfer: Extract<TransferOrganizationOwnershipResult, { transfer: unknown }>["transfer"];
    }
  >();

  registerUser(userId: string): void {
    this.#activeUsers.add(userId);
  }

  registerForUser(
    actorUserId: string,
    organization: MemberOrganizationProjection,
    members: readonly StoredMember[] = [],
  ): void {
    this.#organizations.set(`${organization.id}:${actorUserId}`, { ...organization });
    this.#activeUsers.add(actorUserId);
    for (const member of members) {
      this.#activeUsers.add(member.userId);
      this.#organizations.set(`${organization.id}:${member.userId}`, {
        ...organization,
        role: member.role,
      });
    }
    if (members.length > 0 || !this.#members.has(organization.id)) {
      this.#members.set(
        organization.id,
        members.map((member) => ({ ...member })),
      );
    }
  }

  createOwned(input: CreateOwnedOrganizationInput): Promise<CreateOwnedOrganizationResult> {
    const existing = [...this.#organizations.values()].find(
      (organization) => organization.slug === input.slug,
    );
    if (existing) {
      const ownerScoped = this.#organizations.get(`${existing.id}:${input.ownerUserId}`);
      if (
        ownerScoped?.role === "OWNER" &&
        ownerScoped.type === input.type &&
        ownerScoped.displayName === input.displayName &&
        ownerScoped.legalName === (input.legalName ?? null)
      ) {
        return Promise.resolve({ kind: "existing", organization: ownerScoped });
      }
      return Promise.resolve({ kind: "slug_conflict" });
    }

    const timestamp = new Date("2026-07-28T18:30:00.000Z");
    const organization: MemberOrganizationProjection = {
      id: randomUUID(),
      type: input.type,
      displayName: input.displayName,
      legalName: input.legalName ?? null,
      slug: input.slug,
      status: "ACTIVE",
      verificationStatus: "UNVERIFIED",
      role: "OWNER",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.registerForUser(input.ownerUserId, organization, [
      {
        userId: input.ownerUserId,
        displayName: "Synthetic Owner",
        avatarUrl: null,
        role: "OWNER",
        joinedAt: timestamp,
        updatedAt: timestamp,
        version: 1,
      },
    ]);
    return Promise.resolve({ kind: "created", organization });
  }

  findByIdForMember(
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection | null> {
    return Promise.resolve(this.#organizations.get(`${organizationId}:${actorUserId}`) ?? null);
  }

  listMembers(input: ListOrganizationMembersInput): Promise<OrganizationMemberPage> {
    const membership = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    const ordered = [...(this.#members.get(input.organizationId) ?? [])]
      .sort(
        (left, right) =>
          right.joinedAt.getTime() - left.joinedAt.getTime() ||
          right.userId.localeCompare(left.userId),
      )
      .filter((member) => {
        if (!input.cursor) return true;
        return (
          member.joinedAt < input.cursor.joinedAt ||
          (member.joinedAt.getTime() === input.cursor.joinedAt.getTime() &&
            member.userId < input.cursor.userId)
        );
      });
    const page = ordered.slice(0, input.limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: page,
      nextCursor:
        ordered.length > input.limit && last
          ? { userId: last.userId, joinedAt: last.joinedAt }
          : null,
    });
  }

  createInvitation(
    input: CreateOrganizationInvitationInput,
  ): Promise<CreateOrganizationInvitationResult> {
    const manager = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    if (!manager || (manager.role !== "OWNER" && manager.role !== "ADMIN")) {
      return Promise.resolve({ kind: "actor_forbidden" });
    }
    const idempotencyScope = `${input.actorUserId}:${input.organizationId}:${input.idempotencyKey}`;
    const retry = this.#invitationIdempotency.get(idempotencyScope);
    if (retry) {
      if (retry.requestHash !== input.requestHash) {
        return Promise.resolve({ kind: "idempotency_conflict" });
      }
      const invitation = this.#invitations.get(retry.invitationId);
      if (!invitation) throw new Error("Invitation idempotency record is invalid");
      return Promise.resolve({ kind: "existing", invitation: { ...invitation } });
    }
    if (!this.#activeUsers.has(input.inviteeUserId)) {
      return Promise.resolve({ kind: "invitee_unavailable" });
    }
    if (this.#organizations.has(`${input.organizationId}:${input.inviteeUserId}`)) {
      return Promise.resolve({ kind: "already_member" });
    }
    const pending = [...this.#invitations.values()].find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.inviteeUserId === input.inviteeUserId &&
        candidate.status === "PENDING" &&
        candidate.expiresAt > input.now,
    );
    if (pending) return Promise.resolve({ kind: "pending_conflict" });
    const invitation: OrganizationInvitationProjection = {
      id: randomUUID(),
      organizationId: input.organizationId,
      organizationDisplayName: manager.displayName,
      inviteeUserId: input.inviteeUserId,
      role: input.role,
      status: "PENDING",
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.#invitations.set(invitation.id, invitation);
    this.#invitationIdempotency.set(idempotencyScope, {
      requestHash: input.requestHash,
      invitationId: invitation.id,
    });
    return Promise.resolve({ kind: "created", invitation: { ...invitation } });
  }

  acceptInvitation(
    input: AcceptOrganizationInvitationInput,
  ): Promise<AcceptOrganizationInvitationResult> {
    const invitation = this.#invitations.get(input.invitationId);
    if (!invitation || invitation.inviteeUserId !== input.actorUserId) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (invitation.status === "ACCEPTED") {
      return Promise.resolve({ kind: "existing", invitation: { ...invitation } });
    }
    if (invitation.status !== "PENDING") return Promise.resolve({ kind: "not_found" });
    if (invitation.expiresAt <= input.now) {
      invitation.status = "EXPIRED";
      invitation.updatedAt = input.now;
      return Promise.resolve({ kind: "expired" });
    }
    if (this.#organizations.has(`${invitation.organizationId}:${input.actorUserId}`)) {
      return Promise.resolve({ kind: "member_conflict" });
    }
    const base = [...this.#organizations.values()].find(
      (organization) => organization.id === invitation.organizationId,
    );
    if (!base) return Promise.resolve({ kind: "not_found" });
    invitation.status = "ACCEPTED";
    invitation.acceptedAt = input.now;
    invitation.updatedAt = input.now;
    this.#organizations.set(`${invitation.organizationId}:${input.actorUserId}`, {
      ...base,
      role: invitation.role,
    });
    const members = this.#members.get(invitation.organizationId) ?? [];
    members.push({
      userId: input.actorUserId,
      displayName: "Invited member",
      avatarUrl: null,
      role: invitation.role,
      joinedAt: input.now,
      updatedAt: input.now,
      version: 1,
    });
    this.#members.set(invitation.organizationId, members);
    return Promise.resolve({ kind: "accepted", invitation: { ...invitation } });
  }

  revokeInvitation(
    input: RevokeOrganizationInvitationInput,
  ): Promise<RevokeOrganizationInvitationResult> {
    const manager = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    const invitation = this.#invitations.get(input.invitationId);
    if (
      !manager ||
      (manager.role !== "OWNER" && manager.role !== "ADMIN") ||
      !invitation ||
      invitation.organizationId !== input.organizationId
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (invitation.status === "REVOKED") {
      return Promise.resolve({ kind: "existing", invitation: { ...invitation } });
    }
    if (invitation.status === "PENDING" && invitation.expiresAt <= input.now) {
      invitation.status = "EXPIRED";
      invitation.updatedAt = input.now;
      return Promise.resolve({ kind: "conflict" });
    }
    if (invitation.status !== "PENDING") return Promise.resolve({ kind: "conflict" });
    invitation.status = "REVOKED";
    invitation.revokedAt = input.now;
    invitation.updatedAt = input.now;
    return Promise.resolve({ kind: "revoked", invitation: { ...invitation } });
  }

  changeMemberRole(
    input: ChangeOrganizationMemberRoleInput,
  ): Promise<ChangeOrganizationMemberRoleResult> {
    const manager = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    const members = this.#members.get(input.organizationId) ?? [];
    const member = members.find((candidate) => candidate.userId === input.targetUserId);
    if (
      !manager ||
      (manager.role !== "OWNER" && manager.role !== "ADMIN") ||
      !member ||
      member.role === "OWNER" ||
      member.userId === input.actorUserId
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (member.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "conflict" });
    }
    member.role = input.role;
    member.updatedAt = input.now;
    member.version += 1;
    const organization = this.#organizations.get(`${input.organizationId}:${input.targetUserId}`);
    if (organization) organization.role = input.role;
    return Promise.resolve({ kind: "updated", member: { ...member } });
  }

  removeMember(input: RemoveOrganizationMemberInput): Promise<RemoveOrganizationMemberResult> {
    const manager = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    const members = this.#members.get(input.organizationId) ?? [];
    const index = members.findIndex((candidate) => candidate.userId === input.targetUserId);
    const member = index >= 0 ? members[index] : undefined;
    if (
      !manager ||
      (manager.role !== "OWNER" && manager.role !== "ADMIN") ||
      !member ||
      member.role === "OWNER" ||
      member.userId === input.actorUserId
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (member.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "conflict" });
    }
    members.splice(index, 1);
    this.#organizations.delete(`${input.organizationId}:${input.targetUserId}`);
    return Promise.resolve({ kind: "removed" });
  }

  transferOwnership(
    input: TransferOrganizationOwnershipInput,
  ): Promise<TransferOrganizationOwnershipResult> {
    const idempotencyScope = `${input.actorUserId}:${input.organizationId}:${input.idempotencyKey}`;
    const retry = this.#transfers.get(idempotencyScope);
    if (retry) {
      return Promise.resolve(
        retry.requestHash === input.requestHash
          ? { kind: "existing", transfer: { ...retry.transfer } }
          : { kind: "idempotency_conflict" },
      );
    }
    const owner = this.#organizations.get(`${input.organizationId}:${input.actorUserId}`);
    const target = this.#organizations.get(`${input.organizationId}:${input.targetUserId}`);
    const members = this.#members.get(input.organizationId) ?? [];
    const ownerMember = members.find((member) => member.userId === input.actorUserId);
    const targetMember = members.find((member) => member.userId === input.targetUserId);
    if (
      owner?.role !== "OWNER" ||
      !target ||
      target.role === "OWNER" ||
      !ownerMember ||
      !targetMember
    ) {
      return Promise.resolve({ kind: "not_found" });
    }
    target.role = "OWNER";
    targetMember.role = "OWNER";
    targetMember.updatedAt = input.now;
    targetMember.version += 1;
    owner.role = "ADMIN";
    ownerMember.role = "ADMIN";
    ownerMember.updatedAt = input.now;
    ownerMember.version += 1;
    const transfer = {
      id: randomUUID(),
      organizationId: input.organizationId,
      fromUserId: input.actorUserId,
      toUserId: input.targetUserId,
      fromRoleAfter: "ADMIN" as const,
      toRoleAfter: "OWNER" as const,
      occurredAt: input.now,
    };
    this.#transfers.set(idempotencyScope, { requestHash: input.requestHash, transfer });
    return Promise.resolve({ kind: "transferred", transfer: { ...transfer } });
  }
}
