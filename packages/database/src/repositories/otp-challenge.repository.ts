import { PrismaPg } from "@prisma/adapter-pg";
import {
  OtpChannel,
  OtpPurpose,
  Prisma,
  PrismaClient,
  UserStatus,
} from "../../generated/prisma/client";

const usableUserStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;

export type OtpRateLimit = {
  limit: number;
  windowSeconds: number;
};

export type OtpChallengeCreateInput = {
  id: string;
  actorUserId: string | null;
  channel: OtpChannel;
  destination: string;
  destinationHash: string;
  purpose: OtpPurpose;
  locale: string;
  codeHash: string;
  ipHash: string;
  deviceHash: string;
  expiresAt: Date;
  now: Date;
  limits: {
    destination: OtpRateLimit;
    ip: OtpRateLimit;
    device: OtpRateLimit;
  };
};

export type OtpChallengeCreateResult =
  | {
      kind: "created";
      challenge: {
        id: string;
        expiresAt: Date;
      };
      deliveryAllowed: boolean;
    }
  | {
      kind: "rate_limited";
      retryAfterSeconds: number;
    };

export type OtpChallengeVerifyInput = {
  challengeId: string;
  codeHash: string;
  deviceHash: string;
  now: Date;
  maximumAttempts: number;
};

export type OtpChallengeVerifyResult =
  | { kind: "verified"; userId: string }
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export type OtpChallengeRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

type OtpClient = PrismaClient | Prisma.TransactionClient;

function isRepositoryOptions(
  target: OtpClient | OtpChallengeRepositoryOptions,
): target is OtpChallengeRepositoryOptions {
  return "connectionString" in target;
}

function secondsBefore(now: Date, seconds: number): Date {
  return new Date(now.getTime() - seconds * 1_000);
}

function retryAfter(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000));
}

async function lockAbuseKeys(
  transaction: Prisma.TransactionClient,
  keys: readonly string[],
): Promise<void> {
  for (const key of [...keys].sort()) {
    await transaction.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS locked",
      key,
    );
  }
}

async function activeActor(
  transaction: Prisma.TransactionClient,
  userId: string | null,
): Promise<{ id: string; email: string | null; phoneE164: string | null } | null> {
  if (!userId) return null;
  return transaction.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      status: { in: [...usableUserStatuses] },
      profile: { isNot: null },
    },
    select: { id: true, email: true, phoneE164: true },
  });
}

async function ensureSignInSubject(
  transaction: Prisma.TransactionClient,
  challenge: {
    channel: OtpChannel;
    destination: string;
    locale: string;
  },
): Promise<string | null> {
  const existing = await transaction.user.findUnique({
    where:
      challenge.channel === OtpChannel.EMAIL
        ? { email: challenge.destination }
        : { phoneE164: challenge.destination },
    include: { profile: true },
  });

  if (existing) {
    if (
      existing.deletedAt ||
      (existing.status !== UserStatus.ACTIVE && existing.status !== UserStatus.LIMITED)
    ) {
      return null;
    }
    if (!existing.profile) {
      await transaction.userProfile.create({
        data: {
          userId: existing.id,
          displayName: challenge.locale === "en-US" ? "New member" : "新用户",
          preferredLocale: challenge.locale,
        },
      });
    }
    return existing.id;
  }

  const created = await transaction.user.create({
    data: {
      ...(challenge.channel === OtpChannel.EMAIL
        ? { email: challenge.destination }
        : { phoneE164: challenge.destination }),
      profile: {
        create: {
          displayName: challenge.locale === "en-US" ? "New member" : "新用户",
          preferredLocale: challenge.locale,
        },
      },
    },
    select: { id: true },
  });
  return created.id;
}

export class OtpChallengeRepository {
  readonly #client: OtpClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: OtpClient | OtpChallengeRepositoryOptions) {
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

  create(input: OtpChallengeCreateInput): Promise<OtpChallengeCreateResult> {
    return this.#transaction(async (transaction) => {
      await lockAbuseKeys(transaction, [
        `otp:destination:${input.destinationHash}:${input.purpose}`,
        `otp:device:${input.deviceHash}`,
        `otp:ip:${input.ipHash}`,
      ]);

      const [destinationCount, ipCount, deviceCount, owner, actor] = await Promise.all([
        transaction.otpChallenge.count({
          where: {
            destinationHash: input.destinationHash,
            purpose: input.purpose,
            createdAt: {
              gte: secondsBefore(input.now, input.limits.destination.windowSeconds),
            },
          },
        }),
        transaction.otpChallenge.count({
          where: {
            ipHash: input.ipHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.ip.windowSeconds) },
          },
        }),
        transaction.otpChallenge.count({
          where: {
            deviceHash: input.deviceHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.device.windowSeconds) },
          },
        }),
        transaction.user.findUnique({
          where:
            input.channel === OtpChannel.EMAIL
              ? { email: input.destination }
              : { phoneE164: input.destination },
          select: { id: true },
        }),
        activeActor(transaction, input.actorUserId),
      ]);

      const exceededWindow = [
        destinationCount >= input.limits.destination.limit
          ? input.limits.destination.windowSeconds
          : 0,
        ipCount >= input.limits.ip.limit ? input.limits.ip.windowSeconds : 0,
        deviceCount >= input.limits.device.limit ? input.limits.device.windowSeconds : 0,
      ].reduce((maximum, value) => Math.max(maximum, value), 0);
      if (exceededWindow > 0) {
        return { kind: "rate_limited", retryAfterSeconds: exceededWindow };
      }

      const deliveryAllowed =
        input.purpose === OtpPurpose.SIGN_IN ||
        (input.purpose === OtpPurpose.VERIFY_CONTACT &&
          Boolean(actor) &&
          (!owner || owner.id === actor?.id)) ||
        (input.purpose === OtpPurpose.SENSITIVE_ACTION &&
          Boolean(actor) &&
          owner?.id === actor?.id);
      const subjectUserId =
        input.purpose === OtpPurpose.SIGN_IN
          ? (owner?.id ?? null)
          : deliveryAllowed
            ? (actor?.id ?? null)
            : null;

      await transaction.otpChallenge.updateMany({
        where: {
          destinationHash: input.destinationHash,
          purpose: input.purpose,
          consumedAt: null,
          expiresAt: { gt: input.now },
        },
        data: { consumedAt: input.now },
      });
      const challenge = await transaction.otpChallenge.create({
        data: {
          id: input.id,
          userId: subjectUserId,
          channel: input.channel,
          destination: input.destination,
          destinationHash: input.destinationHash,
          purpose: input.purpose,
          locale: input.locale,
          codeHash: input.codeHash,
          ipHash: input.ipHash,
          deviceHash: input.deviceHash,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        },
        select: { id: true, expiresAt: true },
      });
      return { kind: "created", challenge, deliveryAllowed };
    });
  }

  async verify(input: OtpChallengeVerifyInput): Promise<OtpChallengeVerifyResult> {
    try {
      return await this.#transaction(async (transaction) => {
        await lockAbuseKeys(transaction, [`otp:challenge:${input.challengeId}`]);
        const challenge = await transaction.otpChallenge.findUnique({
          where: { id: input.challengeId },
        });
        if (!challenge || challenge.consumedAt || challenge.expiresAt <= input.now) {
          return { kind: "invalid" };
        }
        if (challenge.failedAttempts >= input.maximumAttempts) {
          return {
            kind: "rate_limited",
            retryAfterSeconds: retryAfter(challenge.expiresAt, input.now),
          };
        }

        if (challenge.deviceHash !== input.deviceHash || challenge.codeHash !== input.codeHash) {
          const failedAttempts = challenge.failedAttempts + 1;
          await transaction.otpChallenge.update({
            where: { id: challenge.id },
            data: { failedAttempts },
          });
          return failedAttempts >= input.maximumAttempts
            ? {
                kind: "rate_limited",
                retryAfterSeconds: retryAfter(challenge.expiresAt, input.now),
              }
            : { kind: "invalid" };
        }

        let userId: string | null = null;
        if (challenge.purpose === OtpPurpose.SIGN_IN) {
          userId = await ensureSignInSubject(transaction, challenge);
        } else {
          const actor = await activeActor(transaction, challenge.userId);
          if (!actor) return { kind: "invalid" };

          if (challenge.purpose === OtpPurpose.SENSITIVE_ACTION) {
            const contactMatches =
              challenge.channel === OtpChannel.EMAIL
                ? actor.email === challenge.destination
                : actor.phoneE164 === challenge.destination;
            if (!contactMatches) return { kind: "invalid" };
          } else {
            await transaction.user.update({
              where: { id: actor.id },
              data:
                challenge.channel === OtpChannel.EMAIL
                  ? { email: challenge.destination }
                  : { phoneE164: challenge.destination },
            });
          }
          userId = actor.id;
        }

        if (!userId) return { kind: "invalid" };
        await transaction.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: input.now, userId },
        });
        await transaction.user.update({
          where: { id: userId },
          data: { lastLoginAt: input.now },
        });
        return { kind: "verified", userId };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { kind: "invalid" };
      }
      throw error;
    }
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) return this.#client.$transaction(callback);
    return callback(this.#client);
  }
}
