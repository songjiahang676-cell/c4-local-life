import { randomUUID } from "node:crypto";
import { OtpChannel, type Prisma } from "../generated/prisma/client";
import { AuthSessionRepository } from "../src/repositories/auth-session.repository";
import {
  PasswordCredentialRepository,
  type PasswordIdentifier,
  type PasswordLoginBeginInput,
} from "../src/repositories/password-credential.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const originalPasswordHash = `$scrypt$ln=17,r=8,p=1$${"A".repeat(43)}$${"B".repeat(86)}`;
const replacementPasswordHash = `$scrypt$ln=17,r=8,p=1$${"C".repeat(43)}$${"D".repeat(86)}`;

async function createPasswordUser(
  transaction: Prisma.TransactionClient,
  userId: string,
  email: string,
): Promise<void> {
  await transaction.user.create({
    data: {
      id: userId,
      email,
      passwordHash: originalPasswordHash,
      passwordChangedAt: new Date("2026-07-28T20:00:00.000Z"),
      profile: {
        create: {
          displayName: "Synthetic Password Repository User",
          preferredLocale: "en-US",
        },
      },
    },
  });
}

function identifier(email: string, suffix = "1"): PasswordIdentifier {
  return {
    kind: "EMAIL",
    value: email,
    hash: suffix.repeat(64),
  };
}

function loginInput(
  attemptId: string,
  subject: PasswordIdentifier,
  now: Date,
): PasswordLoginBeginInput {
  return {
    attemptId,
    identifier: subject,
    ipHash: "b".repeat(64),
    deviceHash: "c".repeat(64),
    now,
    limits: {
      identifier: { limit: 20, windowSeconds: 900 },
      ip: { limit: 20, windowSeconds: 900 },
      device: { limit: 20, windowSeconds: 900 },
    },
  };
}

integration("PasswordCredentialRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("records hash-only login evidence, prevents replay, and persists bounded lockout", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const email = `${userId}@example.invalid`;
      const subject = identifier(email);
      const repository = new PasswordCredentialRepository(transaction);
      const now = new Date("2026-07-28T21:00:00.000Z");
      await createPasswordUser(transaction, userId, email);

      const successfulAttemptId = randomUUID();
      const begun = await repository.beginLogin(loginInput(successfulAttemptId, subject, now));
      expect(begun).toMatchObject({
        kind: "begun",
        userId,
        passwordHash: originalPasswordHash,
        lockedUntil: null,
      });
      await expect(
        repository.completeLogin(
          successfulAttemptId,
          userId,
          originalPasswordHash,
          true,
          3,
          new Date("2026-07-28T21:05:00.000Z"),
          now,
        ),
      ).resolves.toBe(true);
      await expect(
        repository.completeLogin(
          successfulAttemptId,
          userId,
          originalPasswordHash,
          true,
          3,
          new Date("2026-07-28T21:05:00.000Z"),
          now,
        ),
      ).resolves.toBe(false);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const attemptId = randomUUID();
        const attemptNow = new Date(now.getTime() + attempt * 1_000);
        await repository.beginLogin(loginInput(attemptId, subject, attemptNow));
        await repository.completeLogin(
          attemptId,
          userId,
          originalPasswordHash,
          false,
          3,
          new Date("2026-07-28T21:05:00.000Z"),
          attemptNow,
        );
      }

      const locked = await repository.beginLogin(
        loginInput(randomUUID(), subject, new Date("2026-07-28T21:00:10.000Z")),
      );
      expect(locked).toMatchObject({
        kind: "begun",
        userId,
        lockedUntil: new Date("2026-07-28T21:05:00.000Z"),
      });
      const persisted = await transaction.passwordAuthAttempt.findMany({
        where: { userId },
        select: {
          identifierHash: true,
          ipHash: true,
          deviceHash: true,
          outcome: true,
        },
      });
      expect(persisted).toHaveLength(5);
      expect(JSON.stringify(persisted)).not.toContain(email);
      expect(persisted.every((attempt) => attempt.identifierHash === subject.hash)).toBe(true);
    });
  });

  it("atomically consumes recovery, replaces the verifier, revokes sessions, and audits", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const email = `${userId}@example.invalid`;
      const subject = identifier(email, "2");
      const repository = new PasswordCredentialRepository(transaction);
      const sessionRepository = new AuthSessionRepository(transaction);
      const now = new Date("2026-07-28T22:00:00.000Z");
      const availableAt = new Date("2026-07-28T22:05:00.000Z");
      const expiresAt = new Date("2026-07-28T22:30:00.000Z");
      const recoveryId = randomUUID();
      const tokenHash = "e".repeat(64);
      await createPasswordUser(transaction, userId, email);
      await sessionRepository.create({
        userId,
        tokenHash: "f".repeat(64),
        userAgent: "Synthetic Recovery Browser",
        ipHash: "9".repeat(64),
        expiresAt,
        idleExpiresAt: expiresAt,
        authenticationStrength: "PRIMARY",
        mfaVerifiedAt: null,
        now,
      });

      await expect(
        repository.createRecovery({
          id: recoveryId,
          identifier: subject,
          channel: OtpChannel.EMAIL,
          tokenHash,
          ipHash: "7".repeat(64),
          deviceHash: "8".repeat(64),
          availableAt,
          expiresAt,
          now,
          limits: {
            destination: { limit: 3, windowSeconds: 3_600 },
            ip: { limit: 20, windowSeconds: 3_600 },
            device: { limit: 10, windowSeconds: 3_600 },
          },
        }),
      ).resolves.toEqual({
        kind: "created",
        deliveryAllowed: true,
        locale: "en-US",
      });
      await expect(repository.recoveryGate(recoveryId, now, 3)).resolves.toEqual({
        kind: "cooldown",
        retryAfterSeconds: 300,
      });
      await expect(
        repository.completeRecovery({
          id: recoveryId,
          tokenHash: "0".repeat(64),
          passwordHash: replacementPasswordHash,
          now: availableAt,
          maximumAttempts: 3,
          requestId: "password-recovery-invalid-proof",
          ipHash: "7".repeat(64),
        }),
      ).resolves.toEqual({ kind: "invalid" });
      await expect(
        repository.completeRecovery({
          id: recoveryId,
          tokenHash,
          passwordHash: replacementPasswordHash,
          now: new Date("2026-07-28T22:05:01.000Z"),
          maximumAttempts: 3,
          requestId: "password-recovery-completed",
          ipHash: "7".repeat(64),
        }),
      ).resolves.toMatchObject({
        kind: "completed",
        notification: { channel: "EMAIL", destination: email, locale: "en-US" },
      });
      await expect(
        repository.completeRecovery({
          id: recoveryId,
          tokenHash,
          passwordHash: replacementPasswordHash,
          now: new Date("2026-07-28T22:05:02.000Z"),
          maximumAttempts: 3,
          requestId: "password-recovery-replay",
          ipHash: "7".repeat(64),
        }),
      ).resolves.toEqual({ kind: "invalid" });

      const [user, session, recovery, audit] = await Promise.all([
        transaction.user.findUniqueOrThrow({ where: { id: userId } }),
        transaction.authSession.findFirstOrThrow({ where: { userId } }),
        transaction.passwordRecoveryRequest.findUniqueOrThrow({
          where: { id: recoveryId },
        }),
        transaction.auditLog.findFirstOrThrow({
          where: { targetId: userId, action: "auth.password.recovered" },
        }),
      ]);
      expect(user.passwordHash).toBe(replacementPasswordHash);
      expect(user.passwordChangedAt?.toISOString()).toBe("2026-07-28T22:05:01.000Z");
      expect(session.revokedAt?.toISOString()).toBe("2026-07-28T22:05:01.000Z");
      expect(recovery.consumedAt?.toISOString()).toBe("2026-07-28T22:05:01.000Z");
      expect(JSON.stringify({ recovery, audit })).not.toContain(email);
      expect(JSON.stringify(audit)).not.toContain(tokenHash);
      expect(audit.requestId).toBe("password-recovery-completed");
    });
  });

  it("rate-limits unknown accounts without storing plaintext identifiers", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new PasswordCredentialRepository(transaction);
      const now = new Date("2026-07-28T23:00:00.000Z");
      const unknown = identifier("missing@example.invalid", "3");
      const limits = {
        identifier: { limit: 1, windowSeconds: 900 },
        ip: { limit: 100, windowSeconds: 900 },
        device: { limit: 100, windowSeconds: 900 },
      };

      await expect(
        repository.beginLogin({
          ...loginInput(randomUUID(), unknown, now),
          limits,
        }),
      ).resolves.toMatchObject({ kind: "begun", userId: null, passwordHash: null });
      await expect(
        repository.beginLogin({
          ...loginInput(randomUUID(), unknown, new Date(now.getTime() + 1_000)),
          limits,
        }),
      ).resolves.toEqual({ kind: "rate_limited", retryAfterSeconds: 900 });

      const stored = await transaction.passwordAuthAttempt.findFirstOrThrow({
        where: { identifierHash: unknown.hash },
      });
      expect(JSON.stringify(stored)).not.toContain(unknown.value);
    });
  });
});
