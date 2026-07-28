import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { MfaCredentialRepository } from "../src/repositories/mfa-credential.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

async function createUser(
  transaction: Prisma.TransactionClient,
  userId: string,
  withPlatformRole: boolean,
): Promise<void> {
  await transaction.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      profile: {
        create: {
          displayName: "Synthetic MFA Repository User",
          preferredLocale: "en-US",
        },
      },
      ...(withPlatformRole
        ? {
            platformRoles: {
              create: {
                role: "PLATFORM_ADMIN",
                reasonCode: "SYNTHETIC_INTEGRATION_TEST",
              },
            },
          }
        : {}),
    },
  });
}

integration("MfaCredentialRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("requires a current platform role and atomically enforces activation and one-time proofs", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const ordinaryUserId = randomUUID();
      const now = new Date("2026-07-28T20:00:00.000Z");
      const expiresAt = new Date("2026-07-28T20:10:00.000Z");
      await createUser(transaction, userId, true);
      await createUser(transaction, ordinaryUserId, false);
      const repository = new MfaCredentialRepository(transaction);

      await expect(
        repository.startEnrollment({
          userId: ordinaryUserId,
          encryptedSecret: "v1.synthetic",
          keyVersion: 1,
          expiresAt,
          now,
        }),
      ).resolves.toEqual({ kind: "unavailable" });

      const started = await repository.startEnrollment({
        userId,
        encryptedSecret: "v1.synthetic-encrypted-secret",
        keyVersion: 1,
        expiresAt,
        now,
      });
      expect(started.kind).toBe("created");
      if (started.kind !== "created") throw new Error("Expected a pending enrollment");

      const pending = await repository.findPending(userId, started.credentialId, now);
      expect(pending).toMatchObject({
        userId,
        encryptedSecret: "v1.synthetic-encrypted-secret",
        failedAttempts: 0,
      });
      await expect(
        repository.startEnrollment({
          userId,
          encryptedSecret: "v1.must-not-replace-live-pending-secret",
          keyVersion: 1,
          expiresAt: new Date("2026-07-28T20:20:00.000Z"),
          now,
        }),
      ).resolves.toMatchObject({
        kind: "existing",
        credentialId: started.credentialId,
        encryptedSecret: "v1.synthetic-encrypted-secret",
        expiresAt,
      });
      const recoveryHash = "a".repeat(64);
      await expect(
        repository.activate(
          userId,
          started.credentialId,
          100n,
          [recoveryHash],
          now,
          "mfa-enrollment-integration",
        ),
      ).resolves.toBe(true);
      await expect(
        repository.startEnrollment({
          userId,
          encryptedSecret: "v1.replacement",
          keyVersion: 1,
          expiresAt,
          now,
        }),
      ).resolves.toEqual({ kind: "active" });

      await expect(
        repository.consumeTotp(userId, started.credentialId, 101n, now, "mfa-totp-integration"),
      ).resolves.toBe(true);
      await expect(
        repository.consumeTotp(
          userId,
          started.credentialId,
          101n,
          now,
          "mfa-totp-replay-integration",
        ),
      ).resolves.toBe(false);
      await expect(
        repository.consumeRecoveryCode(
          userId,
          started.credentialId,
          recoveryHash,
          now,
          "mfa-recovery-integration",
        ),
      ).resolves.toBe(true);
      await expect(
        repository.consumeRecoveryCode(
          userId,
          started.credentialId,
          recoveryHash,
          now,
          "mfa-recovery-replay-integration",
        ),
      ).resolves.toBe(false);

      const auditActions = await transaction.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: "asc" },
        select: { action: true, metadata: true },
      });
      expect(auditActions.map(({ action }) => action).sort()).toEqual(
        ["admin.mfa.enrolled", "admin.mfa.recovery_code_used", "admin.mfa.verified"].sort(),
      );
      expect(JSON.stringify(auditActions)).not.toContain("synthetic-encrypted-secret");
      expect(JSON.stringify(auditActions)).not.toContain(recoveryHash);
    });
  });

  it("expires pending enrollment and persists bounded verification lockout", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-07-28T20:00:00.000Z");
      await createUser(transaction, userId, true);
      const repository = new MfaCredentialRepository(transaction);
      const started = await repository.startEnrollment({
        userId,
        encryptedSecret: "v1.synthetic-encrypted-secret",
        keyVersion: 1,
        expiresAt: new Date("2026-07-28T20:01:00.000Z"),
        now,
      });
      if (started.kind !== "created") throw new Error("Expected a pending enrollment");

      expect(
        await repository.findPending(
          userId,
          started.credentialId,
          new Date("2026-07-28T20:01:01.000Z"),
        ),
      ).toBeNull();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await repository.recordFailure(
          started.credentialId,
          5,
          new Date("2026-07-28T20:06:00.000Z"),
          now,
        );
      }
      const stored = await transaction.mfaCredential.findUniqueOrThrow({
        where: { id: started.credentialId },
      });
      expect(stored.failedAttempts).toBe(0);
      expect(stored.lockedUntil?.toISOString()).toBe("2026-07-28T20:06:00.000Z");
    });
  });
});
