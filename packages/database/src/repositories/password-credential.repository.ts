import { PrismaPg } from "@prisma/adapter-pg";
import type { Prisma } from "../../generated/prisma/client";
import {
  OtpChannel,
  PasswordAuthAttemptOutcome,
  PrismaClient,
  UserStatus,
} from "../../generated/prisma/client";

const usableUserStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;

export type PasswordRateLimit = {
  limit: number;
  windowSeconds: number;
};

export type PasswordIdentifier = {
  kind: "EMAIL" | "PHONE";
  value: string;
  hash: string;
};

export type PasswordLoginBeginInput = {
  attemptId: string;
  identifier: PasswordIdentifier;
  ipHash: string;
  deviceHash: string;
  now: Date;
  limits: {
    identifier: PasswordRateLimit;
    ip: PasswordRateLimit;
    device: PasswordRateLimit;
  };
};

export type PasswordLoginBeginResult =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | {
      kind: "begun";
      attemptId: string;
      userId: string | null;
      passwordHash: string | null;
      lockedUntil: Date | null;
    };

export type PasswordRecoveryCreateInput = {
  id: string;
  identifier: PasswordIdentifier;
  channel: OtpChannel;
  tokenHash: string;
  ipHash: string;
  deviceHash: string;
  availableAt: Date;
  expiresAt: Date;
  now: Date;
  limits: {
    destination: PasswordRateLimit;
    ip: PasswordRateLimit;
    device: PasswordRateLimit;
  };
};

export type PasswordRecoveryCreateResult =
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | {
      kind: "created";
      deliveryAllowed: boolean;
      locale: "zh-Hans" | "en-US";
    };

export type PasswordRecoveryCompleteInput = {
  id: string;
  tokenHash: string;
  passwordHash: string;
  now: Date;
  maximumAttempts: number;
  requestId: string;
  ipHash: string;
};

export type PasswordRecoveryCompleteResult =
  | { kind: "invalid" }
  | { kind: "cooldown"; retryAfterSeconds: number }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | {
      kind: "completed";
      notification: {
        channel: "EMAIL" | "SMS";
        destination: string;
        locale: "zh-Hans" | "en-US";
      };
    };

export type PasswordRecoveryGateResult =
  | { kind: "invalid" }
  | { kind: "ready" }
  | { kind: "cooldown"; retryAfterSeconds: number }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export type PasswordCredentialRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

type PasswordClient = PrismaClient | Prisma.TransactionClient;

function isRepositoryOptions(
  target: PasswordClient | PasswordCredentialRepositoryOptions,
): target is PasswordCredentialRepositoryOptions {
  return "connectionString" in target;
}

function secondsBefore(now: Date, seconds: number): Date {
  return new Date(now.getTime() - seconds * 1_000);
}

function secondsUntil(value: Date, now: Date): number {
  return Math.max(1, Math.ceil((value.getTime() - now.getTime()) / 1_000));
}

function normalizedLocale(value: string): "zh-Hans" | "en-US" {
  return value === "en-US" ? "en-US" : "zh-Hans";
}

async function lockKeys(
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

function identifierWhere(
  identifier: PasswordIdentifier,
): { email: string } | { phoneE164: string } {
  return identifier.kind === "EMAIL"
    ? { email: identifier.value }
    : { phoneE164: identifier.value };
}

export class PasswordCredentialRepository {
  readonly #client: PasswordClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: PasswordClient | PasswordCredentialRepositoryOptions) {
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

  beginLogin(input: PasswordLoginBeginInput): Promise<PasswordLoginBeginResult> {
    return this.#transaction(async (transaction) => {
      await lockKeys(transaction, [
        `password-login:identifier:${input.identifier.hash}`,
        `password-login:ip:${input.ipHash}`,
        `password-login:device:${input.deviceHash}`,
      ]);
      const [identifierCount, ipCount, deviceCount, candidate] = await Promise.all([
        transaction.passwordAuthAttempt.count({
          where: {
            identifierHash: input.identifier.hash,
            createdAt: { gte: secondsBefore(input.now, input.limits.identifier.windowSeconds) },
          },
        }),
        transaction.passwordAuthAttempt.count({
          where: {
            ipHash: input.ipHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.ip.windowSeconds) },
          },
        }),
        transaction.passwordAuthAttempt.count({
          where: {
            deviceHash: input.deviceHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.device.windowSeconds) },
          },
        }),
        transaction.user.findUnique({
          where: identifierWhere(input.identifier),
          select: {
            id: true,
            status: true,
            deletedAt: true,
            passwordHash: true,
            passwordLockedUntil: true,
            profile: { select: { userId: true } },
          },
        }),
      ]);
      const exceededWindow = [
        identifierCount >= input.limits.identifier.limit
          ? input.limits.identifier.windowSeconds
          : 0,
        ipCount >= input.limits.ip.limit ? input.limits.ip.windowSeconds : 0,
        deviceCount >= input.limits.device.limit ? input.limits.device.windowSeconds : 0,
      ].reduce((maximum, value) => Math.max(maximum, value), 0);
      if (exceededWindow > 0) {
        return { kind: "rate_limited", retryAfterSeconds: exceededWindow };
      }

      const usable =
        candidate &&
        !candidate.deletedAt &&
        candidate.profile &&
        usableUserStatuses.includes(candidate.status as (typeof usableUserStatuses)[number])
          ? candidate
          : null;
      await transaction.passwordAuthAttempt.create({
        data: {
          id: input.attemptId,
          userId: usable?.id ?? null,
          identifierHash: input.identifier.hash,
          ipHash: input.ipHash,
          deviceHash: input.deviceHash,
          createdAt: input.now,
        },
      });
      return {
        kind: "begun",
        attemptId: input.attemptId,
        userId: usable?.id ?? null,
        passwordHash: usable?.passwordHash ?? null,
        lockedUntil: usable?.passwordLockedUntil ?? null,
      };
    });
  }

  completeLogin(
    attemptId: string,
    userId: string | null,
    expectedPasswordHash: string | null,
    success: boolean,
    maximumFailures: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      await lockKeys(transaction, [
        `password-login:attempt:${attemptId}`,
        ...(userId ? [`password-login:user:${userId}`] : []),
      ]);
      const attempt = await transaction.passwordAuthAttempt.findUnique({
        where: { id: attemptId },
        select: { outcome: true },
      });
      if (!attempt || attempt.outcome !== PasswordAuthAttemptOutcome.PENDING) return false;

      if (success) {
        const updated =
          userId && expectedPasswordHash
            ? await transaction.user.updateMany({
                where: {
                  id: userId,
                  passwordHash: expectedPasswordHash,
                  deletedAt: null,
                  status: { in: [...usableUserStatuses] },
                },
                data: { passwordFailedAttempts: 0, passwordLockedUntil: null },
              })
            : { count: 0 };
        const accepted = updated.count === 1;
        await transaction.passwordAuthAttempt.update({
          where: { id: attemptId },
          data: {
            outcome: accepted
              ? PasswordAuthAttemptOutcome.SUCCESS
              : PasswordAuthAttemptOutcome.FAILURE,
            completedAt: now,
          },
        });
        return accepted;
      }

      await transaction.passwordAuthAttempt.update({
        where: { id: attemptId },
        data: {
          outcome: PasswordAuthAttemptOutcome.FAILURE,
          completedAt: now,
        },
      });
      if (!userId || !expectedPasswordHash) return false;

      const failed = await transaction.user.updateMany({
        where: {
          id: userId,
          passwordHash: expectedPasswordHash,
          deletedAt: null,
          status: { in: [...usableUserStatuses] },
        },
        data: { passwordFailedAttempts: { increment: 1 } },
      });
      if (failed.count !== 1) return false;
      const current = await transaction.user.findUnique({
        where: { id: userId },
        select: { passwordFailedAttempts: true },
      });
      if ((current?.passwordFailedAttempts ?? 0) >= maximumFailures) {
        await transaction.user.update({
          where: { id: userId },
          data: { passwordFailedAttempts: 0, passwordLockedUntil: lockedUntil },
        });
      }
      return false;
    });
  }

  createRecovery(input: PasswordRecoveryCreateInput): Promise<PasswordRecoveryCreateResult> {
    return this.#transaction(async (transaction) => {
      await lockKeys(transaction, [
        `password-recovery:destination:${input.identifier.hash}`,
        `password-recovery:ip:${input.ipHash}`,
        `password-recovery:device:${input.deviceHash}`,
      ]);
      const [destinationCount, ipCount, deviceCount, candidate] = await Promise.all([
        transaction.passwordRecoveryRequest.count({
          where: {
            destinationHash: input.identifier.hash,
            createdAt: { gte: secondsBefore(input.now, input.limits.destination.windowSeconds) },
          },
        }),
        transaction.passwordRecoveryRequest.count({
          where: {
            ipHash: input.ipHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.ip.windowSeconds) },
          },
        }),
        transaction.passwordRecoveryRequest.count({
          where: {
            deviceHash: input.deviceHash,
            createdAt: { gte: secondsBefore(input.now, input.limits.device.windowSeconds) },
          },
        }),
        transaction.user.findUnique({
          where: identifierWhere(input.identifier),
          select: {
            id: true,
            status: true,
            deletedAt: true,
            profile: { select: { preferredLocale: true } },
          },
        }),
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

      const usable =
        candidate &&
        !candidate.deletedAt &&
        candidate.profile &&
        usableUserStatuses.includes(candidate.status as (typeof usableUserStatuses)[number])
          ? candidate
          : null;
      await transaction.passwordRecoveryRequest.updateMany({
        where: {
          destinationHash: input.identifier.hash,
          consumedAt: null,
          supersededAt: null,
          expiresAt: { gt: input.now },
        },
        data: { supersededAt: input.now },
      });
      await transaction.passwordRecoveryRequest.create({
        data: {
          id: input.id,
          userId: usable?.id ?? null,
          channel: input.channel,
          destinationHash: input.identifier.hash,
          tokenHash: input.tokenHash,
          ipHash: input.ipHash,
          deviceHash: input.deviceHash,
          availableAt: input.availableAt,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        },
      });
      return {
        kind: "created",
        deliveryAllowed: Boolean(usable),
        locale: normalizedLocale(usable?.profile?.preferredLocale ?? "zh-Hans"),
      };
    });
  }

  async recoveryGate(
    id: string,
    now: Date,
    maximumAttempts: number,
  ): Promise<PasswordRecoveryGateResult> {
    const recovery = await this.#client.passwordRecoveryRequest.findUnique({
      where: { id },
      select: {
        userId: true,
        availableAt: true,
        expiresAt: true,
        failedAttempts: true,
        consumedAt: true,
        supersededAt: true,
      },
    });
    if (
      !recovery ||
      !recovery.userId ||
      recovery.consumedAt ||
      recovery.supersededAt ||
      recovery.expiresAt <= now
    ) {
      return { kind: "invalid" };
    }
    if (recovery.failedAttempts >= maximumAttempts) {
      return { kind: "rate_limited", retryAfterSeconds: secondsUntil(recovery.expiresAt, now) };
    }
    if (recovery.availableAt > now) {
      return { kind: "cooldown", retryAfterSeconds: secondsUntil(recovery.availableAt, now) };
    }
    return { kind: "ready" };
  }

  completeRecovery(input: PasswordRecoveryCompleteInput): Promise<PasswordRecoveryCompleteResult> {
    return this.#transaction(async (transaction) => {
      await lockKeys(transaction, [`password-recovery:request:${input.id}`]);
      const recovery = await transaction.passwordRecoveryRequest.findUnique({
        where: { id: input.id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phoneE164: true,
              status: true,
              deletedAt: true,
              profile: { select: { preferredLocale: true } },
            },
          },
        },
      });
      if (
        !recovery ||
        recovery.consumedAt ||
        recovery.supersededAt ||
        recovery.expiresAt <= input.now ||
        !recovery.user ||
        recovery.user.deletedAt ||
        !usableUserStatuses.includes(recovery.user.status as (typeof usableUserStatuses)[number])
      ) {
        return { kind: "invalid" };
      }
      if (recovery.failedAttempts >= input.maximumAttempts) {
        return {
          kind: "rate_limited",
          retryAfterSeconds: secondsUntil(recovery.expiresAt, input.now),
        };
      }
      if (recovery.availableAt > input.now) {
        return {
          kind: "cooldown",
          retryAfterSeconds: secondsUntil(recovery.availableAt, input.now),
        };
      }
      if (recovery.tokenHash !== input.tokenHash) {
        const failedAttempts = recovery.failedAttempts + 1;
        await transaction.passwordRecoveryRequest.update({
          where: { id: input.id },
          data: {
            failedAttempts,
            ...(failedAttempts >= input.maximumAttempts ? { supersededAt: input.now } : {}),
          },
        });
        return failedAttempts >= input.maximumAttempts
          ? {
              kind: "rate_limited",
              retryAfterSeconds: secondsUntil(recovery.expiresAt, input.now),
            }
          : { kind: "invalid" };
      }

      const destination =
        recovery.channel === OtpChannel.EMAIL ? recovery.user.email : recovery.user.phoneE164;
      if (!destination) return { kind: "invalid" };

      await transaction.user.update({
        where: { id: recovery.user.id },
        data: {
          passwordHash: input.passwordHash,
          passwordChangedAt: input.now,
          passwordFailedAttempts: 0,
          passwordLockedUntil: null,
        },
      });
      await transaction.authSession.updateMany({
        where: { userId: recovery.user.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.passwordRecoveryRequest.update({
        where: { id: input.id },
        data: { consumedAt: input.now, failedAttempts: 0 },
      });
      await transaction.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "auth.password.recovered",
          targetType: "USER",
          targetId: recovery.user.id,
          requestId: input.requestId,
          ipHash: input.ipHash,
          metadata: { method: recovery.channel },
          createdAt: input.now,
        },
      });
      return {
        kind: "completed",
        notification: {
          channel: recovery.channel,
          destination,
          locale: normalizedLocale(recovery.user.profile?.preferredLocale ?? "zh-Hans"),
        },
      };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) return this.#client.$transaction(callback);
    return callback(this.#client);
  }
}
