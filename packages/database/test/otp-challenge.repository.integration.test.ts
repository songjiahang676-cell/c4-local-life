import { randomUUID } from "node:crypto";
import { OtpChannel, OtpPurpose, type Prisma } from "../generated/prisma/client";
import {
  OtpChallengeRepository,
  type OtpChallengeCreateInput,
} from "../src/repositories/otp-challenge.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

function createInput(overrides: Partial<OtpChallengeCreateInput> = {}): OtpChallengeCreateInput {
  const now = overrides.now ?? new Date("2026-07-26T12:00:00.000Z");
  return {
    id: randomUUID(),
    actorUserId: null,
    channel: OtpChannel.EMAIL,
    destination: `${randomUUID()}@example.invalid`,
    destinationHash: randomUUID().replaceAll("-", ""),
    purpose: OtpPurpose.SIGN_IN,
    locale: "en-US",
    codeHash: randomUUID().replaceAll("-", ""),
    ipHash: randomUUID().replaceAll("-", ""),
    deviceHash: randomUUID().replaceAll("-", ""),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
    now,
    limits: {
      destination: { limit: 3, windowSeconds: 900 },
      ip: { limit: 20, windowSeconds: 3_600 },
      device: { limit: 10, windowSeconds: 3_600 },
    },
    ...overrides,
  };
}

async function createUser(transaction: Prisma.TransactionClient, email: string): Promise<string> {
  const user = await transaction.user.create({
    data: {
      email,
      profile: {
        create: {
          displayName: "Synthetic OTP Actor",
          preferredLocale: "en-US",
        },
      },
    },
    select: { id: true },
  });
  return user.id;
}

integration("OtpChallengeRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("persists hash-only OTP credentials and enforces destination limits atomically", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new OtpChallengeRepository(transaction);
      const base = createInput({
        destination: "rate-limit@example.invalid",
        destinationHash: "a".repeat(64),
      });

      const results = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        results.push(
          await repository.create(
            createInput({
              ...base,
              id: randomUUID(),
              codeHash: attempt.toString().repeat(64),
              now: new Date(base.now.getTime() + attempt * 1_000),
            }),
          ),
        );
      }
      const persisted = await transaction.otpChallenge.findFirstOrThrow({
        where: { destinationHash: base.destinationHash },
      });

      expect(results.slice(0, 3).every((result) => result.kind === "created")).toBe(true);
      expect(results.at(-1)).toEqual({
        kind: "rate_limited",
        retryAfterSeconds: 900,
      });
      expect(persisted.codeHash).not.toBe("000000");
      expect(persisted.destinationHash).not.toContain(persisted.destination);
      expect(
        await transaction.otpChallenge.count({ where: { destinationHash: "a".repeat(64) } }),
      ).toBe(3);
    });
  });

  it("creates a minimal profile on successful sign-in and consumes the challenge once", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new OtpChallengeRepository(transaction);
      const input = createInput({
        destination: "new-member@example.invalid",
        destinationHash: "b".repeat(64),
        codeHash: "c".repeat(64),
        deviceHash: "d".repeat(64),
      });
      const created = await repository.create(input);
      const wrong = await repository.verify({
        challengeId: input.id,
        codeHash: "e".repeat(64),
        deviceHash: input.deviceHash,
        now: new Date(input.now.getTime() + 10_000),
        maximumAttempts: 5,
      });
      const verified = await repository.verify({
        challengeId: input.id,
        codeHash: input.codeHash,
        deviceHash: input.deviceHash,
        now: new Date(input.now.getTime() + 20_000),
        maximumAttempts: 5,
      });
      const replay = await repository.verify({
        challengeId: input.id,
        codeHash: input.codeHash,
        deviceHash: input.deviceHash,
        now: new Date(input.now.getTime() + 30_000),
        maximumAttempts: 5,
      });
      const user = await transaction.user.findUniqueOrThrow({
        where: { email: input.destination },
        include: { profile: true },
      });
      const challenge = await transaction.otpChallenge.findUniqueOrThrow({
        where: { id: input.id },
      });

      expect(created).toMatchObject({ kind: "created", deliveryAllowed: true });
      expect(wrong).toEqual({ kind: "invalid" });
      expect(verified).toEqual({ kind: "verified", userId: user.id });
      expect(replay).toEqual({ kind: "invalid" });
      expect(user.profile).toMatchObject({
        displayName: "New member",
        preferredLocale: "en-US",
      });
      expect(challenge.failedAttempts).toBe(1);
      expect(challenge.consumedAt).not.toBeNull();
    });
  });

  it("supersedes an older live challenge for the same destination and purpose", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new OtpChallengeRepository(transaction);
      const first = createInput({
        destination: "latest-only@example.invalid",
        destinationHash: "5".repeat(64),
        codeHash: "6".repeat(64),
        deviceHash: "7".repeat(64),
      });
      const second = createInput({
        ...first,
        id: randomUUID(),
        codeHash: "8".repeat(64),
        now: new Date(first.now.getTime() + 1_000),
      });
      await repository.create(first);
      await repository.create(second);

      const oldResult = await repository.verify({
        challengeId: first.id,
        codeHash: first.codeHash,
        deviceHash: first.deviceHash,
        now: new Date(second.now.getTime() + 1_000),
        maximumAttempts: 5,
      });
      const latestResult = await repository.verify({
        challengeId: second.id,
        codeHash: second.codeHash,
        deviceHash: second.deviceHash,
        now: new Date(second.now.getTime() + 2_000),
        maximumAttempts: 5,
      });

      expect(oldResult).toEqual({ kind: "invalid" });
      expect(latestResult.kind).toBe("verified");
    });
  });

  it("binds verification to the requesting device and stops guesses at the configured maximum", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new OtpChallengeRepository(transaction);
      const input = createInput({
        destinationHash: "f".repeat(64),
        codeHash: "1".repeat(64),
        deviceHash: "2".repeat(64),
      });
      await repository.create(input);

      const results = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        results.push(
          await repository.verify({
            challengeId: input.id,
            codeHash: input.codeHash,
            deviceHash: "3".repeat(64),
            now: new Date(input.now.getTime() + attempt * 1_000),
            maximumAttempts: 5,
          }),
        );
      }

      expect(results.slice(0, 4).every((result) => result.kind === "invalid")).toBe(true);
      expect(results.at(-1)?.kind).toBe("rate_limited");
      expect(
        (await transaction.otpChallenge.findUniqueOrThrow({ where: { id: input.id } }))
          .failedAttempts,
      ).toBe(5);
    });
  });

  it("creates a non-deliverable decoy when contact verification targets another account", async () => {
    await database.withRollback(async (transaction) => {
      const actorId = await createUser(transaction, "actor@example.invalid");
      await createUser(transaction, "owned@example.invalid");
      const repository = new OtpChallengeRepository(transaction);
      const input = createInput({
        actorUserId: actorId,
        destination: "owned@example.invalid",
        destinationHash: "4".repeat(64),
        purpose: OtpPurpose.VERIFY_CONTACT,
      });

      const created = await repository.create(input);
      const persisted = await transaction.otpChallenge.findUniqueOrThrow({
        where: { id: input.id },
      });

      expect(created).toMatchObject({ kind: "created", deliveryAllowed: false });
      expect(persisted.userId).toBeNull();
    });
  });
});
