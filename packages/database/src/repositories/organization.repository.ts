import { PrismaPg } from "@prisma/adapter-pg";
import {
  MembershipRole,
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
      select: {
        userId: true,
        role: true,
        createdAt: true,
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
      },
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.flatMap((row) => {
      if (!row.user.profile) return [];
      return [
        {
          userId: row.userId,
          displayName: row.user.profile.displayName,
          avatarUrl: row.user.profile.avatarUrl,
          role: row.role,
          joinedAt: row.createdAt,
        },
      ];
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
