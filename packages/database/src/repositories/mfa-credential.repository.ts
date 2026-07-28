import { PrismaPg } from "@prisma/adapter-pg";
import {
  MfaCredentialStatus,
  PrismaClient,
  UserStatus,
  type Prisma,
} from "../../generated/prisma/client";

export type MfaCredentialState = {
  credentialId: string | null;
  status: "NOT_ENROLLED" | "PENDING" | "ACTIVE" | "DISABLED";
  enrollmentExpiresAt: Date | null;
  activatedAt: Date | null;
};

export type MfaCredentialSecret = {
  id: string;
  userId: string;
  encryptedSecret: string;
  keyVersion: number;
  lastUsedStep: bigint | null;
  failedAttempts: number;
  lockedUntil: Date | null;
};

export type MfaEnrollmentStartInput = {
  userId: string;
  encryptedSecret: string;
  keyVersion: number;
  expiresAt: Date;
  now: Date;
};

export type MfaEnrollmentStartResult =
  | { kind: "created"; credentialId: string }
  | {
      kind: "existing";
      credentialId: string;
      encryptedSecret: string;
      keyVersion: number;
      expiresAt: Date;
    }
  | { kind: "active" }
  | { kind: "unavailable" };

export type MfaCredentialRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

type MfaClient = PrismaClient | Prisma.TransactionClient;

function isRepositoryOptions(
  target: MfaClient | MfaCredentialRepositoryOptions,
): target is MfaCredentialRepositoryOptions {
  return "connectionString" in target;
}

function mapSecret(row: {
  id: string;
  userId: string;
  encryptedSecret: string;
  keyVersion: number;
  lastUsedStep: bigint | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}): MfaCredentialSecret {
  return {
    id: row.id,
    userId: row.userId,
    encryptedSecret: row.encryptedSecret,
    keyVersion: row.keyVersion,
    lastUsedStep: row.lastUsedStep,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
  };
}

export class MfaCredentialRepository {
  readonly #client: MfaClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: MfaClient | MfaCredentialRepositoryOptions) {
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

  async findState(userId: string, now: Date): Promise<MfaCredentialState> {
    const row = await this.#client.mfaCredential.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        enrollmentExpiresAt: true,
        activatedAt: true,
      },
    });
    if (!row) {
      return {
        credentialId: null,
        status: "NOT_ENROLLED",
        enrollmentExpiresAt: null,
        activatedAt: null,
      };
    }
    const status =
      row.status === MfaCredentialStatus.PENDING && row.enrollmentExpiresAt <= now
        ? "NOT_ENROLLED"
        : row.status;
    return {
      credentialId: row.id,
      status,
      enrollmentExpiresAt: status === "PENDING" ? row.enrollmentExpiresAt : null,
      activatedAt: row.activatedAt,
    };
  }

  startEnrollment(input: MfaEnrollmentStartInput): Promise<MfaEnrollmentStartResult> {
    return this.#transaction(async (transaction) => {
      const subject = await transaction.user.findFirst({
        where: {
          id: input.userId,
          status: UserStatus.ACTIVE,
          deletedAt: null,
          platformRoles: {
            some: {
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
            },
          },
        },
        select: { id: true },
      });
      if (!subject) return { kind: "unavailable" };

      const existing = await transaction.mfaCredential.findUnique({
        where: { userId: input.userId },
        select: {
          id: true,
          status: true,
          encryptedSecret: true,
          keyVersion: true,
          enrollmentExpiresAt: true,
        },
      });
      if (existing?.status === MfaCredentialStatus.ACTIVE) return { kind: "active" };
      if (existing?.status === MfaCredentialStatus.DISABLED) return { kind: "unavailable" };
      if (
        existing?.status === MfaCredentialStatus.PENDING &&
        existing.enrollmentExpiresAt > input.now
      ) {
        return {
          kind: "existing",
          credentialId: existing.id,
          encryptedSecret: existing.encryptedSecret,
          keyVersion: existing.keyVersion,
          expiresAt: existing.enrollmentExpiresAt,
        };
      }

      const row = await transaction.mfaCredential.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          encryptedSecret: input.encryptedSecret,
          keyVersion: input.keyVersion,
          enrollmentExpiresAt: input.expiresAt,
          status: MfaCredentialStatus.PENDING,
          createdAt: input.now,
          updatedAt: input.now,
        },
        update: {
          encryptedSecret: input.encryptedSecret,
          keyVersion: input.keyVersion,
          enrollmentExpiresAt: input.expiresAt,
          failedAttempts: 0,
          lockedUntil: null,
          lastUsedStep: null,
          updatedAt: input.now,
        },
        select: { id: true },
      });
      return { kind: "created", credentialId: row.id };
    });
  }

  async findPending(
    userId: string,
    credentialId: string,
    now: Date,
  ): Promise<MfaCredentialSecret | null> {
    const row = await this.#client.mfaCredential.findFirst({
      where: {
        id: credentialId,
        userId,
        status: MfaCredentialStatus.PENDING,
        enrollmentExpiresAt: { gt: now },
      },
      select: {
        id: true,
        userId: true,
        encryptedSecret: true,
        keyVersion: true,
        lastUsedStep: true,
        failedAttempts: true,
        lockedUntil: true,
      },
    });
    return row ? mapSecret(row) : null;
  }

  async findActive(userId: string): Promise<MfaCredentialSecret | null> {
    const row = await this.#client.mfaCredential.findFirst({
      where: {
        userId,
        status: MfaCredentialStatus.ACTIVE,
        disabledAt: null,
      },
      select: {
        id: true,
        userId: true,
        encryptedSecret: true,
        keyVersion: true,
        lastUsedStep: true,
        failedAttempts: true,
        lockedUntil: true,
      },
    });
    return row ? mapSecret(row) : null;
  }

  activate(
    userId: string,
    credentialId: string,
    lastUsedStep: bigint,
    recoveryCodeHashes: readonly string[],
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const activated = await transaction.mfaCredential.updateMany({
        where: {
          id: credentialId,
          userId,
          status: MfaCredentialStatus.PENDING,
          enrollmentExpiresAt: { gt: now },
        },
        data: {
          status: MfaCredentialStatus.ACTIVE,
          activatedAt: now,
          lastUsedStep,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        },
      });
      if (activated.count !== 1) return false;
      await transaction.mfaRecoveryCode.createMany({
        data: recoveryCodeHashes.map((codeHash) => ({
          credentialId,
          codeHash,
          createdAt: now,
        })),
      });
      await transaction.auditLog.create({
        data: {
          actorId: userId,
          actorType: "USER",
          action: "admin.mfa.enrolled",
          targetType: "MFA_CREDENTIAL",
          targetId: credentialId,
          requestId,
          metadata: { method: "TOTP", recoveryCodeCount: recoveryCodeHashes.length },
          createdAt: now,
        },
      });
      return true;
    });
  }

  async consumeTotp(
    userId: string,
    credentialId: string,
    step: bigint,
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const consumed = await transaction.mfaCredential.updateMany({
        where: {
          id: credentialId,
          userId,
          status: MfaCredentialStatus.ACTIVE,
          disabledAt: null,
          AND: [
            { OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] },
            { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
          ],
        },
        data: {
          lastUsedStep: step,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: now,
        },
      });
      if (consumed.count !== 1) return false;
      await transaction.auditLog.create({
        data: {
          actorId: userId,
          actorType: "USER",
          action: "admin.mfa.verified",
          targetType: "MFA_CREDENTIAL",
          targetId: credentialId,
          requestId,
          metadata: { method: "TOTP" },
          createdAt: now,
        },
      });
      return true;
    });
  }

  consumeRecoveryCode(
    userId: string,
    credentialId: string,
    codeHash: string,
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const credential = await transaction.mfaCredential.findFirst({
        where: {
          id: credentialId,
          userId,
          status: MfaCredentialStatus.ACTIVE,
          disabledAt: null,
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
        select: { id: true },
      });
      if (!credential) return false;
      const consumed = await transaction.mfaRecoveryCode.updateMany({
        where: {
          credentialId,
          codeHash,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await transaction.mfaCredential.update({
        where: { id: credentialId },
        data: { failedAttempts: 0, lockedUntil: null, updatedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: userId,
          actorType: "USER",
          action: "admin.mfa.recovery_code_used",
          targetType: "MFA_CREDENTIAL",
          targetId: credentialId,
          requestId,
          metadata: { method: "RECOVERY_CODE" },
          createdAt: now,
        },
      });
      return true;
    });
  }

  recordFailure(
    credentialId: string,
    maxAttempts: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<void> {
    return this.#transaction(async (transaction) => {
      const updated = await transaction.mfaCredential.update({
        where: { id: credentialId },
        data: { failedAttempts: { increment: 1 }, updatedAt: now },
        select: { failedAttempts: true },
      });
      if (updated.failedAttempts >= maxAttempts) {
        await transaction.mfaCredential.update({
          where: { id: credentialId },
          data: { failedAttempts: 0, lockedUntil, updatedAt: now },
        });
      }
    });
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
