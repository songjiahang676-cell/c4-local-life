import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  UserStatus,
  type MembershipRole,
  type OrganizationType,
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
};

export type AuthSessionRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
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
    },
  },
} satisfies Prisma.AuthSessionInclude;

type SessionWithPrincipal = Prisma.AuthSessionGetPayload<{
  include: typeof activeSessionInclude;
}>;

function mapPrincipal(row: SessionWithPrincipal): AuthSessionPrincipal | null {
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
  return row ? mapPrincipal(row) : null;
}

function isRepositoryOptions(
  target: SessionClient | AuthSessionRepositoryOptions,
): target is AuthSessionRepositoryOptions {
  return "connectionString" in target;
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
