import { randomUUID } from "node:crypto";
import {
  MediaAssetRepository,
  MediaKind,
  MediaPurpose,
  MediaStatus,
} from "../src/repositories/media-asset.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("MediaAssetRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("reserves an opaque intent with owner-bound exact idempotency", async () => {
    await database.withRollback(async (transaction) => {
      const ownerId = randomUUID();
      await transaction.user.create({
        data: {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          profile: { create: { displayName: "Synthetic Media Owner" } },
        },
      });
      const repository = new MediaAssetRepository(transaction);
      const mediaId = randomUUID();
      const now = new Date("2026-07-28T20:15:00.000Z");
      const input = {
        id: mediaId,
        ownerId,
        purpose: MediaPurpose.LISTING_MEDIA,
        kind: MediaKind.IMAGE,
        bucket: "socal-test-quarantine",
        objectKey: `quarantine/${mediaId.slice(0, 2)}/${mediaId}/original`,
        mimeType: "image/webp",
        byteSize: 4_096,
        sha256: "a".repeat(64),
        idempotencyKey: "repository-media-upload-0001",
        requestHash: "b".repeat(64),
        now,
        uploadExpiresAt: new Date(now.getTime() + 300_000),
        maximumActive: 20,
        dailyByteLimit: 209_715_200,
      };

      const created = await repository.reserveUploadIntent(input);
      const replayed = await repository.reserveUploadIntent({ ...input, id: randomUUID() });
      const conflict = await repository.reserveUploadIntent({
        ...input,
        id: randomUUID(),
        requestHash: "c".repeat(64),
      });

      expect(created).toMatchObject({
        kind: "created",
        intent: {
          id: mediaId,
          ownerId,
          status: MediaStatus.UPLOADING,
          objectKey: input.objectKey,
        },
      });
      expect(replayed).toMatchObject({ kind: "existing", intent: { id: mediaId } });
      expect(conflict).toEqual({ kind: "idempotency_conflict" });
      await expect(transaction.mediaAsset.count({ where: { ownerId } })).resolves.toBe(1);
    });
  });

  it("enforces active-count and rolling daily-byte quotas inside the owner lock", async () => {
    await database.withRollback(async (transaction) => {
      const ownerId = randomUUID();
      await transaction.user.create({
        data: {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          profile: { create: { displayName: "Synthetic Quota Owner" } },
        },
      });
      const repository = new MediaAssetRepository(transaction);
      const now = new Date("2026-07-28T20:15:00.000Z");
      const reserve = (overrides: {
        id?: string;
        idempotencyKey: string;
        byteSize?: number;
        maximumActive?: number;
        dailyByteLimit?: number;
      }) => {
        const id = overrides.id ?? randomUUID();
        return repository.reserveUploadIntent({
          id,
          ownerId,
          purpose: MediaPurpose.LISTING_MEDIA,
          kind: MediaKind.IMAGE,
          bucket: "socal-test-quarantine",
          objectKey: `quarantine/${id.slice(0, 2)}/${id}/original`,
          mimeType: "image/jpeg",
          byteSize: overrides.byteSize ?? 100,
          sha256: "d".repeat(64),
          idempotencyKey: overrides.idempotencyKey,
          requestHash: createRequestHash(overrides.idempotencyKey),
          now,
          uploadExpiresAt: new Date(now.getTime() + 300_000),
          maximumActive: overrides.maximumActive ?? 20,
          dailyByteLimit: overrides.dailyByteLimit ?? 1_000,
        });
      };

      await expect(
        reserve({ idempotencyKey: "repository-media-quota-0001", maximumActive: 1 }),
      ).resolves.toMatchObject({ kind: "created" });
      await expect(
        reserve({ idempotencyKey: "repository-media-quota-0002", maximumActive: 1 }),
      ).resolves.toMatchObject({ kind: "active_quota_exceeded" });
      await transaction.mediaAsset.updateMany({
        where: { ownerId },
        data: { status: MediaStatus.REJECTED },
      });
      await expect(
        reserve({
          idempotencyKey: "repository-media-quota-0003",
          byteSize: 51,
          dailyByteLimit: 150,
        }),
      ).resolves.toMatchObject({ kind: "daily_byte_quota_exceeded" });
      await expect(transaction.mediaAsset.count({ where: { ownerId } })).resolves.toBe(1);
    });
  });

  it("rejects unavailable actors and database-level unsafe metadata", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new MediaAssetRepository(transaction);
      const ownerId = randomUUID();
      const mediaId = randomUUID();
      const now = new Date("2026-07-28T20:15:00.000Z");
      await expect(
        repository.reserveUploadIntent({
          id: mediaId,
          ownerId,
          purpose: MediaPurpose.LISTING_MEDIA,
          kind: MediaKind.IMAGE,
          bucket: "socal-test-quarantine",
          objectKey: `quarantine/${mediaId.slice(0, 2)}/${mediaId}/original`,
          mimeType: "image/webp",
          byteSize: 100,
          sha256: "a".repeat(64),
          idempotencyKey: "repository-media-actor-0001",
          requestHash: "b".repeat(64),
          now,
          uploadExpiresAt: new Date(now.getTime() + 300_000),
          maximumActive: 20,
          dailyByteLimit: 1_000,
        }),
      ).resolves.toEqual({ kind: "actor_unavailable" });

      await transaction.user.create({
        data: {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          profile: { create: { displayName: "Synthetic Constraint Owner" } },
        },
      });
      await expect(
        transaction.mediaAsset.create({
          data: {
            id: randomUUID(),
            ownerId,
            purpose: MediaPurpose.LISTING_MEDIA,
            kind: MediaKind.IMAGE,
            bucket: "socal-test-quarantine",
            objectKey: "public/original-name.svg",
            mimeType: "image/svg+xml",
            byteSize: 100,
            sha256: "A".repeat(64),
            idempotencyKey: "repository-media-unsafe-0001",
            requestHash: "b".repeat(64),
            uploadExpiresAt: new Date(now.getTime() + 300_000),
          },
        }),
      ).rejects.toThrow();
    });
  });

  it("serializes concurrent quota reservations for the same owner", async () => {
    const ownerId = randomUUID();
    const repository = new MediaAssetRepository(database.client);
    const now = new Date();
    await database.client.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.invalid`,
        profile: { create: { displayName: "Synthetic Concurrent Owner" } },
      },
    });
    try {
      const reserve = (sequence: number) => {
        const id = randomUUID();
        return repository.reserveUploadIntent({
          id,
          ownerId,
          purpose: MediaPurpose.LISTING_MEDIA,
          kind: MediaKind.IMAGE,
          bucket: "socal-test-quarantine",
          objectKey: `quarantine/${id.slice(0, 2)}/${id}/original`,
          mimeType: "image/jpeg",
          byteSize: 100,
          sha256: "e".repeat(64),
          idempotencyKey: `repository-media-concurrent-000${sequence}`,
          requestHash: `${sequence}`.repeat(64),
          now,
          uploadExpiresAt: new Date(now.getTime() + 300_000),
          maximumActive: 1,
          dailyByteLimit: 1_000,
        });
      };
      const results = await Promise.all([reserve(1), reserve(2)]);

      expect(results.map((result) => result.kind).sort()).toEqual([
        "active_quota_exceeded",
        "created",
      ]);
      await expect(database.client.mediaAsset.count({ where: { ownerId } })).resolves.toBe(1);
    } finally {
      await database.client.mediaAsset.deleteMany({ where: { ownerId } });
      await database.client.user.delete({ where: { id: ownerId } });
    }
  });
});

function createRequestHash(value: string): string {
  return Buffer.from(value, "utf8").toString("hex").padEnd(64, "0").slice(0, 64);
}
