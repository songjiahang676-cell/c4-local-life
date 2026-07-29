import { randomUUID } from "node:crypto";
import {
  MediaAssetRepository,
  MediaKind,
  MediaPurpose,
  MediaStatus,
  MediaVariantKind,
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
        data: {
          status: MediaStatus.REJECTED,
          uploadedAt: now,
          processedAt: now,
          rejectionCode: "TEST_REJECTED",
        },
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

  it("atomically moves an owner-verified object to SCANNING with one Outbox event", async () => {
    await database.withRollback(async (transaction) => {
      const ownerId = randomUUID();
      await transaction.user.create({
        data: {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          profile: { create: { displayName: "Synthetic Completion Owner" } },
        },
      });
      const repository = new MediaAssetRepository(transaction);
      const now = new Date("2026-07-29T00:30:00.000Z");
      const intent = await reserveIntent(repository, ownerId, now, "media-complete-0001");
      const eventId = randomUUID();

      const completed = await repository.completeUpload({
        id: intent.id,
        ownerId,
        eventId,
        now: new Date(now.getTime() + 60_000),
        observed: {
          byteSize: intent.byteSize,
          mimeType: intent.mimeType,
          sha256: intent.sha256,
        },
      });
      const replayed = await repository.completeUpload({
        id: intent.id,
        ownerId,
        eventId: randomUUID(),
        now: new Date(now.getTime() + 61_000),
        observed: {
          byteSize: intent.byteSize,
          mimeType: intent.mimeType,
          sha256: intent.sha256,
        },
      });

      expect(completed).toMatchObject({ kind: "accepted", status: "SCANNING" });
      expect(replayed).toMatchObject({ kind: "existing", status: "SCANNING" });
      await expect(
        transaction.mediaAsset.findUniqueOrThrow({ where: { id: intent.id } }),
      ).resolves.toMatchObject({
        status: MediaStatus.SCANNING,
        lifecycleVersion: 1,
        rejectionCode: null,
      });
      await expect(
        transaction.outboxEvent.count({ where: { aggregateId: intent.id } }),
      ).resolves.toBe(1);
      await expect(
        transaction.outboxEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).resolves.toMatchObject({
        eventType: "media.upload.completed",
        payload: { mediaId: intent.id, lifecycleVersion: 1 },
      });
    });
  });

  it("fails closed for cross-owner, expired and mismatched completion", async () => {
    await database.withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const outsiderId = randomUUID();
      await transaction.user.createMany({
        data: [
          { id: ownerId, email: `${ownerId}@example.invalid` },
          { id: outsiderId, email: `${outsiderId}@example.invalid` },
        ],
      });
      const repository = new MediaAssetRepository(transaction);
      const now = new Date("2026-07-29T00:30:00.000Z");
      const mismatched = await reserveIntent(repository, ownerId, now, "media-complete-0002");
      const expired = await reserveIntent(repository, ownerId, now, "media-complete-0003");

      await expect(
        repository.completeUpload({
          id: mismatched.id,
          ownerId: outsiderId,
          eventId: randomUUID(),
          now,
          observed: {
            byteSize: mismatched.byteSize,
            mimeType: mismatched.mimeType,
            sha256: mismatched.sha256,
          },
        }),
      ).resolves.toEqual({ kind: "not_found" });
      await expect(
        repository.completeUpload({
          id: mismatched.id,
          ownerId,
          eventId: randomUUID(),
          now,
          observed: {
            byteSize: mismatched.byteSize + 1,
            mimeType: mismatched.mimeType,
            sha256: mismatched.sha256,
          },
        }),
      ).resolves.toEqual({ kind: "invalid", reason: "OBJECT_METADATA_MISMATCH" });
      await expect(
        repository.completeUpload({
          id: expired.id,
          ownerId,
          eventId: randomUUID(),
          now: new Date(expired.uploadExpiresAt.getTime() + 1),
          observed: {
            byteSize: expired.byteSize,
            mimeType: expired.mimeType,
            sha256: expired.sha256,
          },
        }),
      ).resolves.toEqual({ kind: "invalid", reason: "UPLOAD_EXPIRED" });

      const rejected = await transaction.mediaAsset.findMany({
        where: { id: { in: [mismatched.id, expired.id] } },
        orderBy: { rejectionCode: "asc" },
      });
      expect(rejected).toHaveLength(2);
      expect(rejected.every((asset) => asset.status === MediaStatus.REJECTED)).toBe(true);
      await expect(
        transaction.outboxEvent.count({
          where: {
            aggregateId: { in: [mismatched.id, expired.id] },
            eventType: "media.processing.rejected",
          },
        }),
      ).resolves.toBe(2);
    });
  });

  it("atomically publishes the safe variant set and makes duplicate delivery a no-op", async () => {
    await database.withRollback(async (transaction) => {
      const ownerId = randomUUID();
      await transaction.user.create({
        data: { id: ownerId, email: `${ownerId}@example.invalid` },
      });
      const repository = new MediaAssetRepository(transaction);
      const now = new Date("2026-07-29T00:30:00.000Z");
      const intent = await reserveIntent(repository, ownerId, now, "media-finalize-0001");
      const completion = await repository.completeUpload({
        id: intent.id,
        ownerId,
        eventId: randomUUID(),
        now: new Date(now.getTime() + 1_000),
        observed: {
          byteSize: intent.byteSize,
          mimeType: intent.mimeType,
          sha256: intent.sha256,
        },
      });
      if (completion.kind !== "accepted") throw new Error("Expected accepted completion");
      const variants = [
        { kind: MediaVariantKind.THUMBNAIL, suffix: "thumbnail", width: 320, height: 180 },
        { kind: MediaVariantKind.CARD, suffix: "card", width: 960, height: 540 },
        { kind: MediaVariantKind.FULL, suffix: "full", width: 1920, height: 1080 },
      ].map((variant) => ({
        id: randomUUID(),
        kind: variant.kind,
        bucket: "socal-safe-media",
        objectKey: `processed/${intent.id.slice(0, 2)}/${intent.id}/${variant.suffix}.webp`,
        mimeType: "image/webp" as const,
        byteSize: 1_024,
        sha256: "f".repeat(64),
        width: variant.width,
        height: variant.height,
      }));
      await expect(
        repository.finalizeProcessing({
          id: intent.id,
          lifecycleVersion: 1,
          eventId: randomUUID(),
          now: new Date(now.getTime() + 1_500),
          detectedMimeType: "image/jpeg",
          width: 1920,
          height: 1080,
          perceptualHash: "0123456789abcdef",
          variants: variants.slice(0, 2),
        }),
      ).rejects.toThrow("one THUMBNAIL, CARD, and FULL variant");
      const finalized = await repository.finalizeProcessing({
        id: intent.id,
        lifecycleVersion: 1,
        eventId: randomUUID(),
        now: new Date(now.getTime() + 2_000),
        detectedMimeType: "image/jpeg",
        width: 1920,
        height: 1080,
        perceptualHash: "0123456789abcdef",
        variants,
      });
      const duplicate = await repository.finalizeProcessing({
        id: intent.id,
        lifecycleVersion: 1,
        eventId: randomUUID(),
        now: new Date(now.getTime() + 3_000),
        detectedMimeType: "image/jpeg",
        width: 1920,
        height: 1080,
        perceptualHash: "0123456789abcdef",
        variants: variants.map((variant) => ({ ...variant, id: randomUUID() })),
      });

      expect(finalized).toBe("updated");
      expect(duplicate).toBe("existing");
      await expect(
        transaction.mediaAsset.findUniqueOrThrow({ where: { id: intent.id } }),
      ).resolves.toMatchObject({
        status: MediaStatus.READY,
        lifecycleVersion: 2,
        detectedMimeType: "image/jpeg",
        perceptualHash: "0123456789abcdef",
        rejectionCode: null,
      });
      await expect(
        transaction.mediaVariant.count({ where: { mediaAssetId: intent.id } }),
      ).resolves.toBe(3);
      await expect(
        transaction.outboxEvent.count({
          where: { aggregateId: intent.id, eventType: "media.processing.ready" },
        }),
      ).resolves.toBe(1);
      await expect(repository.findOwnedStatus(intent.id, ownerId)).resolves.toMatchObject({
        id: intent.id,
        status: MediaStatus.READY,
        rejectionCode: null,
      });
      await expect(repository.findOwnedStatus(intent.id, randomUUID())).resolves.toBeNull();
      await transaction.mediaAsset.update({
        where: { id: intent.id },
        data: { status: MediaStatus.DELETED },
      });
      await expect(repository.findOwnedStatus(intent.id, ownerId)).resolves.toBeNull();
    });
  });
});

function createRequestHash(value: string): string {
  return Buffer.from(value, "utf8").toString("hex").padEnd(64, "0").slice(0, 64);
}

async function reserveIntent(
  repository: MediaAssetRepository,
  ownerId: string,
  now: Date,
  idempotencyKey: string,
) {
  const id = randomUUID();
  const result = await repository.reserveUploadIntent({
    id,
    ownerId,
    purpose: MediaPurpose.LISTING_MEDIA,
    kind: MediaKind.IMAGE,
    bucket: "socal-test-quarantine",
    objectKey: `quarantine/${id.slice(0, 2)}/${id}/original`,
    mimeType: "image/jpeg",
    byteSize: 1_024,
    sha256: "a".repeat(64),
    idempotencyKey,
    requestHash: createRequestHash(idempotencyKey),
    now,
    uploadExpiresAt: new Date(now.getTime() + 300_000),
    maximumActive: 20,
    dailyByteLimit: 209_715_200,
  });
  if (result.kind !== "created") throw new Error("Expected media intent creation");
  return result.intent;
}
