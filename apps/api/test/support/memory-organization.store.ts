import { randomUUID } from "node:crypto";
import type {
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationMemberPage,
  OrganizationStore,
} from "../../src/modules/organizations/organization.store";

type StoredMember = OrganizationMemberPage["items"][number];

export class MemoryOrganizationStore implements OrganizationStore {
  readonly #organizations = new Map<string, MemberOrganizationProjection>();
  readonly #members = new Map<string, StoredMember[]>();

  registerForUser(
    actorUserId: string,
    organization: MemberOrganizationProjection,
    members: readonly StoredMember[] = [],
  ): void {
    this.#organizations.set(`${organization.id}:${actorUserId}`, { ...organization });
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
}
