import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  UserStatus,
  type MembershipRole,
  type OrganizationType,
  type PlatformRole,
  type Prisma,
} from "../../generated/prisma/client";

const usableUserStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;

export type AuthSessionCreateInput = {
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipHash: string | null;
  expiresAt: Date;
  idleExpiresAt: Date;
  authenticationStrength: "PRIMARY" | "MFA";
  mfaVerifiedAt: Date | null;
  now: Date;
};

export type AuthSessionRotateInput = AuthSessionCreateInput & {
  currentTokenHash: string;
};

export type AuthSessionPrincipal = {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    idleExpiresAt: Date;
    lastSeenAt: Date;
    createdAt: Date;
    authenticationStrength: "PRIMARY" | "MFA";
    mfaVerifiedAt: Date | null;
  };
  user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    preferredLocale: string;
    status: "ACTIVE" | "LIMITED";
  };
  organizations: Array<{
    id: string;
    type: OrganizationType;
    displayName: string;
    slug: string;
    role: MembershipRole;
  }>;
  platformRoles: PlatformRole[];
};

export type AuthSessionRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type UserProfileProjection = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  preferredLocale: string;
  homeRegionId: string | null;
  version: number;
  updatedAt: Date;
};

export type UserProfileUpdateInput = {
  userId: string;
  expectedVersion: number;
  displayName?: string;
  bio?: string | null;
  preferredLocale?: "zh-Hans" | "en-US";
  homeRegionId?: string | null;
};

export type UserProfileUpdateResult =
  | { kind: "updated"; profile: UserProfileProjection }
  | { kind: "conflict" }
  | { kind: "invalid_region" }
  | { kind: "not_found" };

export type SessionListCursor = {
  id: string;
  lastSeenAt: Date;
};

export type ActiveSessionDevice = {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type UserSessionListInput = {
  userId: string;
  now: Date;
  limit: number;
  cursor?: SessionListCursor;
};

export type UserSessionListResult = {
  items: ActiveSessionDevice[];
  nextCursor: SessionListCursor | null;
};

type SessionClient = PrismaClient | Prisma.TransactionClient;

const activeSessionInclude = {
  user: {
    include: {
      profile: true,
      memberships: {
        where: {
          organization: {
            deletedAt: null,
            status: { in: [...usableUserStatuses] },
          },
        },
        include: { organization: true },
      },
      platformRoles: {
        select: {
          role: true,
          revokedAt: true,
          expiresAt: true,
        },
      },
    },
  },
} satisfies Prisma.AuthSessionInclude;

type SessionWithPrincipal = Prisma.AuthSessionGetPayload<{
  include: typeof activeSessionInclude;
}>;

function mapPrincipal(row: SessionWithPrincipal, now: Date): AuthSessionPrincipal | null {
  const profile = row.user.profile;
  if (!profile) return null;
  if (row.user.status !== UserStatus.ACTIVE && row.user.status !== UserStatus.LIMITED) return null;

  return {
    session: {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      idleExpiresAt: row.idleExpiresAt,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      authenticationStrength: row.authenticationStrength,
      mfaVerifiedAt: row.mfaVerifiedAt,
    },
    user: {
      id: row.user.id,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      preferredLocale: profile.preferredLocale,
      status: row.user.status,
    },
    organizations: row.user.memberships.map(({ organization, role }) => ({
      id: organization.id,
      type: organization.type,
      displayName: organization.displayName,
      slug: organization.slug,
      role,
    })),
    platformRoles: [
      ...new Set(
        row.user.platformRoles
          .filter(
            (assignment) =>
              assignment.revokedAt === null &&
              (assignment.expiresAt === null || assignment.expiresAt > now),
          )
          .map((assignment) => assignment.role),
      ),
    ].sort(),
  };
}

async function findActive(
  client: SessionClient,
  tokenHash: string,
  now: Date,
): Promise<AuthSessionPrincipal | null> {
  const row = await client.authSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now },
      idleExpiresAt: { gt: now },
      user: {
        deletedAt: null,
        status: { in: [...usableUserStatuses] },
        profile: { isNot: null },
      },
    },
    include: activeSessionInclude,
  });
  return row ? mapPrincipal(row, now) : null;
}

function isRepositoryOptions(
  target: SessionClient | AuthSessionRepositoryOptions,
): target is AuthSessionRepositoryOptions {
  return "connectionString" in target;
}

function earlierDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}

function mapProfile(row: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  preferredLocale: string;
  homeRegionId: string | null;
  version: number;
  updatedAt: Date;
}): UserProfileProjection {
  return {
    id: row.userId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    preferredLocale: row.preferredLocale,
    homeRegionId: row.homeRegionId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export class AuthSessionRepository {
  readonly #client: SessionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: SessionClient | AuthSessionRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 20,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
    } else {
      this.#client = target;
      this.#ownedClient = null;
    }
  }

  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionPrincipal | null> {
    return findActive(this.#client, tokenHash, now);
  }

  create(input: AuthSessionCreateInput): Promise<AuthSessionPrincipal | null> {
    return this.#transaction(async (transaction) => {
      const subject = await transaction.user.findFirst({
        where: {
          id: input.userId,
          deletedAt: null,
          status: { in: [...usableUserStatuses] },
          profile: { isNot: null },
        },
        select: { id: true },
      });
      if (!subject) return null;

      await transaction.authSession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          userAgent: input.userAgent,
          ipHash: input.ipHash,
          expiresAt: input.expiresAt,
          idleExpiresAt: input.idleExpiresAt,
          authenticationStrength: input.authenticationStrength,
          mfaVerifiedAt: input.mfaVerifiedAt,
          lastSeenAt: input.now,
          createdAt: input.now,
        },
      });
      return findActive(transaction, input.tokenHash, input.now);
    });
  }

  rotate(input: AuthSessionRotateInput): Promise<AuthSessionPrincipal | null> {
    return this.#transaction(async (transaction) => {
      const current = await findActive(transaction, input.currentTokenHash, input.now);
      if (!current || current.user.id !== input.userId) return null;

      const revoked = await transaction.authSession.updateMany({
        where: {
          id: current.session.id,
          revokedAt: null,
          expiresAt: { gt: input.now },
          idleExpiresAt: { gt: input.now },
        },
        data: { revokedAt: input.now },
      });
      if (revoked.count !== 1) return null;

      await transaction.authSession.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          userAgent: input.userAgent,
          ipHash: input.ipHash,
          expiresAt: input.expiresAt,
          idleExpiresAt: input.idleExpiresAt,
          authenticationStrength: input.authenticationStrength,
          mfaVerifiedAt: input.mfaVerifiedAt,
          lastSeenAt: input.now,
          createdAt: input.now,
        },
      });
      return findActive(transaction, input.tokenHash, input.now);
    });
  }

  async touch(
    tokenHash: string,
    now: Date,
    touchBefore: Date,
    idleExpiresAt: Date,
  ): Promise<boolean> {
    const touched = await this.#client.authSession.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        idleExpiresAt: { gt: now },
        lastSeenAt: { lte: touchBefore },
      },
      data: { lastSeenAt: now, idleExpiresAt },
    });
    if (touched.count === 1) return true;
    return (await findActive(this.#client, tokenHash, now)) !== null;
  }

  async revokeByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    const result = await this.#client.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    return result.count === 1;
  }

  async findProfile(userId: string): Promise<UserProfileProjection | null> {
    const row = await this.#client.userProfile.findFirst({
      where: {
        userId,
        user: {
          deletedAt: null,
          status: { in: [...usableUserStatuses] },
        },
      },
    });
    return row ? mapProfile(row) : null;
  }

  updateProfile(input: UserProfileUpdateInput): Promise<UserProfileUpdateResult> {
    return this.#transaction(async (transaction) => {
      if (input.homeRegionId) {
        const region = await transaction.region.findFirst({
          where: { id: input.homeRegionId, isActive: true },
          select: { id: true },
        });
        if (!region) return { kind: "invalid_region" };
      }

      const updated = await transaction.userProfile.updateMany({
        where: {
          userId: input.userId,
          version: input.expectedVersion,
          user: {
            deletedAt: null,
            status: { in: [...usableUserStatuses] },
          },
        },
        data: {
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.bio === undefined ? {} : { bio: input.bio }),
          ...(input.preferredLocale === undefined
            ? {}
            : { preferredLocale: input.preferredLocale }),
          ...(input.homeRegionId === undefined ? {} : { homeRegionId: input.homeRegionId }),
          version: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        const profile = await transaction.userProfile.findUniqueOrThrow({
          where: { userId: input.userId },
        });
        return { kind: "updated", profile: mapProfile(profile) };
      }

      const exists = await transaction.userProfile.findFirst({
        where: {
          userId: input.userId,
          user: {
            deletedAt: null,
            status: { in: [...usableUserStatuses] },
          },
        },
        select: { userId: true },
      });
      return exists ? { kind: "conflict" } : { kind: "not_found" };
    });
  }

  async listActiveSessions(input: UserSessionListInput): Promise<UserSessionListResult> {
    const rows = await this.#client.authSession.findMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        expiresAt: { gt: input.now },
        idleExpiresAt: { gt: input.now },
        user: {
          deletedAt: null,
          status: { in: [...usableUserStatuses] },
        },
        ...(input.cursor
          ? {
              OR: [
                { lastSeenAt: { lt: input.cursor.lastSeenAt } },
                {
                  lastSeenAt: input.cursor.lastSeenAt,
                  id: { lt: input.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        idleExpiresAt: true,
      },
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: earlierDate(row.expiresAt, row.idleExpiresAt),
      })),
      nextCursor:
        hasMore && last
          ? {
              id: last.id,
              lastSeenAt: last.lastSeenAt,
            }
          : null,
    };
  }

  async revokeSessionForUser(userId: string, sessionId: string, now: Date): Promise<void> {
    await this.#client.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllSessionsForUser(userId: string, now: Date): Promise<number> {
    const revoked = await this.#client.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return revoked.count;
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) {
      return this.#client.$transaction(callback);
    }
    return callback(this.#client);
  }
}
