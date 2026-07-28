import { randomUUID } from "node:crypto";
import { UserStatus, type Prisma } from "../generated/prisma/client";
import {
  AuthSessionRepository,
  type AuthSessionCreateInput,
} from "../src/repositories/auth-session.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

async function createSubject(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
  await transaction.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      profile: {
        create: {
          displayName: "Synthetic Repository User",
          preferredLocale: "zh-Hans",
        },
      },
    },
  });
}

function createInput(userId: string, tokenHash: string, now: Date): AuthSessionCreateInput {
  return {
    userId,
    tokenHash,
    userAgent: "Synthetic Integration Browser",
    ipHash: "f".repeat(64),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    idleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    now,
  };
}

integration("AuthSessionRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("persists hash-only lifecycle metadata and resolves a safe principal projection", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-07-25T12:00:00.000Z");
      const tokenHash = "a".repeat(64);
      await createSubject(transaction, userId);
      const repository = new AuthSessionRepository(transaction);

      const created = await repository.create(createInput(userId, tokenHash, now));
      const persisted = await transaction.authSession.findUniqueOrThrow({
        where: { tokenHash },
      });
      const resolved = await repository.findActiveByTokenHash(
        tokenHash,
        new Date("2026-07-25T12:01:00.000Z"),
      );

      expect(created).toMatchObject({
        user: {
          id: userId,
          displayName: "Synthetic Repository User",
          preferredLocale: "zh-Hans",
          status: "ACTIVE",
        },
      });
      expect(persisted.tokenHash).toBe(tokenHash);
      expect(persisted.userAgent).toBe("Synthetic Integration Browser");
      expect(persisted.ipHash).toBe("f".repeat(64));
      expect(resolved?.session.id).toBe(persisted.id);
      expect(resolved).not.toHaveProperty("user.email");
      expect(resolved).not.toHaveProperty("session.tokenHash");
    });
  });

  it("rotates in one transaction and makes replay of the old token a no-op", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-07-25T12:00:00.000Z");
      const oldHash = "b".repeat(64);
      const newHash = "c".repeat(64);
      await createSubject(transaction, userId);
      const repository = new AuthSessionRepository(transaction);
      await repository.create(createInput(userId, oldHash, now));

      const rotated = await repository.rotate({
        ...createInput(userId, newHash, new Date("2026-07-25T12:05:00.000Z")),
        currentTokenHash: oldHash,
      });
      const replay = await repository.rotate({
        ...createInput(userId, "d".repeat(64), new Date("2026-07-25T12:06:00.000Z")),
        currentTokenHash: oldHash,
      });
      const old = await transaction.authSession.findUniqueOrThrow({
        where: { tokenHash: oldHash },
      });

      expect(rotated?.session.userId).toBe(userId);
      expect(old.revokedAt?.toISOString()).toBe("2026-07-25T12:05:00.000Z");
      expect(replay).toBeNull();
      expect(await transaction.authSession.count({ where: { userId } })).toBe(2);
    });
  });

  it("enforces absolute/idle expiry, logout, and account-state revocation", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-07-25T12:00:00.000Z");
      const tokenHash = "e".repeat(64);
      await createSubject(transaction, userId);
      const repository = new AuthSessionRepository(transaction);
      await repository.create(createInput(userId, tokenHash, now));

      expect(
        await repository.findActiveByTokenHash(tokenHash, new Date("2026-07-25T12:30:01.000Z")),
      ).toBeNull();
      expect(await repository.revokeByTokenHash(tokenHash, now)).toBe(true);
      expect(await repository.revokeByTokenHash(tokenHash, now)).toBe(false);

      const secondHash = "1".repeat(64);
      await repository.create(createInput(userId, secondHash, now));
      await transaction.user.update({
        where: { id: userId },
        data: { status: UserStatus.SUSPENDED },
      });
      const stateRevoked = await transaction.authSession.findUniqueOrThrow({
        where: { tokenHash: secondHash },
      });
      expect(
        await repository.findActiveByTokenHash(secondHash, new Date("2026-07-25T12:01:00.000Z")),
      ).toBeNull();
      expect(stateRevoked.revokedAt).not.toBeNull();
    });
  });

  it("refreshes idle expiry without extending past the absolute deadline", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-07-25T12:00:00.000Z");
      const tokenHash = "2".repeat(64);
      await createSubject(transaction, userId);
      const repository = new AuthSessionRepository(transaction);
      const input = createInput(userId, tokenHash, now);
      await repository.create(input);

      const touchAt = new Date("2026-07-25T12:20:00.000Z");
      expect(
        await repository.touch(
          tokenHash,
          touchAt,
          new Date("2026-07-25T12:19:00.000Z"),
          input.expiresAt,
        ),
      ).toBe(true);
      const persisted = await transaction.authSession.findUniqueOrThrow({
        where: { tokenHash },
      });

      expect(persisted.lastSeenAt.toISOString()).toBe(touchAt.toISOString());
      expect(persisted.idleExpiresAt.toISOString()).toBe(input.expiresAt.toISOString());
    });
  });

  it("updates the safe profile projection with optimistic concurrency and active regions", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const activeRegionId = randomUUID();
      const inactiveRegionId = randomUUID();
      await createSubject(transaction, userId);
      await transaction.region.createMany({
        data: [
          {
            id: activeRegionId,
            type: "CITY",
            code: `TEST-ACTIVE-${activeRegionId}`,
            slug: `active-${activeRegionId}`,
            nameZhHans: "测试活跃地区",
            nameEn: "Synthetic active region",
            isActive: true,
          },
          {
            id: inactiveRegionId,
            type: "CITY",
            code: `TEST-INACTIVE-${inactiveRegionId}`,
            slug: `inactive-${inactiveRegionId}`,
            nameZhHans: "测试停用地区",
            nameEn: "Synthetic inactive region",
            isActive: false,
          },
        ],
      });
      const repository = new AuthSessionRepository(transaction);

      const initial = await repository.findProfile(userId);
      const updated = await repository.updateProfile({
        userId,
        expectedVersion: 1,
        displayName: "Updated Repository User",
        bio: "Synthetic profile update",
        preferredLocale: "en-US",
        homeRegionId: activeRegionId,
      });
      const stale = await repository.updateProfile({
        userId,
        expectedVersion: 1,
        displayName: "Stale",
      });
      const invalidRegion = await repository.updateProfile({
        userId,
        expectedVersion: 2,
        homeRegionId: inactiveRegionId,
      });

      expect(initial).toMatchObject({
        id: userId,
        displayName: "Synthetic Repository User",
        version: 1,
      });
      expect(initial).not.toHaveProperty("email");
      expect(updated).toMatchObject({
        kind: "updated",
        profile: {
          id: userId,
          displayName: "Updated Repository User",
          bio: "Synthetic profile update",
          preferredLocale: "en-US",
          homeRegionId: activeRegionId,
          version: 2,
        },
      });
      expect(stale).toEqual({ kind: "conflict" });
      expect(invalidRegion).toEqual({ kind: "invalid_region" });
    });
  });

  it("paginates and revokes only user-owned active sessions", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const foreignUserId = randomUUID();
      const base = new Date("2026-07-25T12:00:00.000Z");
      await createSubject(transaction, userId);
      await createSubject(transaction, foreignUserId);
      const repository = new AuthSessionRepository(transaction);
      const first = await repository.create(createInput(userId, "3".repeat(64), base));
      const second = await repository.create(
        createInput(userId, "4".repeat(64), new Date(base.getTime() + 1_000)),
      );
      const foreign = await repository.create(
        createInput(foreignUserId, "5".repeat(64), new Date(base.getTime() + 2_000)),
      );
      const now = new Date(base.getTime() + 3_000);

      const firstPage = await repository.listActiveSessions({
        userId,
        now,
        limit: 1,
      });
      const secondPage = await repository.listActiveSessions({
        userId,
        now,
        limit: 1,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(firstPage.items.map((session) => session.id)).toEqual([second?.session.id]);
      expect(firstPage.nextCursor).not.toBeNull();
      expect(secondPage.items.map((session) => session.id)).toEqual([first?.session.id]);
      expect(secondPage.nextCursor).toBeNull();
      expect(JSON.stringify(firstPage)).not.toContain("4".repeat(64));

      await repository.revokeSessionForUser(userId, foreign?.session.id ?? randomUUID(), now);
      expect(
        await repository.findActiveByTokenHash("5".repeat(64), new Date(now.getTime() + 1)),
      ).not.toBeNull();

      await repository.revokeSessionForUser(userId, second?.session.id ?? randomUUID(), now);
      expect(
        await repository.findActiveByTokenHash("4".repeat(64), new Date(now.getTime() + 1)),
      ).toBeNull();
      expect(await repository.revokeAllSessionsForUser(userId, now)).toBe(1);
      expect(
        await repository.findActiveByTokenHash("3".repeat(64), new Date(now.getTime() + 1)),
      ).toBeNull();
      expect(
        await repository.findActiveByTokenHash("5".repeat(64), new Date(now.getTime() + 1)),
      ).not.toBeNull();
    });
  });
});
