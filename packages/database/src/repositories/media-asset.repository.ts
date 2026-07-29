import { PrismaPg } from "@prisma/adapter-pg";
import {
  MediaStatus,
  MediaVariantKind,
  Prisma,
  PrismaClient,
  UserStatus,
  type MediaKind,
  type MediaPurpose,
} from "../../generated/prisma/client";

export {
  MediaKind,
  MediaPurpose,
  MediaStatus,
  MediaVariantKind,
} from "../../generated/prisma/client";

export type MediaAssetRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type MediaUploadIntentRecord = {
  id: string;
  ownerId: string;
  purpose: MediaPurpose;
  kind: MediaKind;
  status: MediaStatus;
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  idempotencyKey: string;
  requestHash: string;
  uploadExpiresAt: Date;
  createdAt: Date;
};

export type OwnedMediaStatusRecord = {
  id: string;
  status: Exclude<MediaStatus, "DELETED">;
  rejectionCode: string | null;
  updatedAt: Date;
};

export type ReserveMediaUploadIntentInput = {
  id: string;
  ownerId: string;
  purpose: MediaPurpose;
  kind: MediaKind;
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
  uploadExpiresAt: Date;
  maximumActive: number;
  dailyByteLimit: number;
};

export type ReserveMediaUploadIntentResult =
  | { kind: "created" | "existing"; intent: MediaUploadIntentRecord }
  | { kind: "idempotency_conflict" }
  | { kind: "active_quota_exceeded"; retryAfter: Date }
  | { kind: "daily_byte_quota_exceeded"; retryAfter: Date }
  | { kind: "actor_unavailable" };

export type CompleteMediaUploadInput = {
  id: string;
  ownerId: string;
  eventId: string;
  now: Date;
  observed: {
    byteSize: number;
    mimeType: string;
    sha256: string;
  };
};

export type CompleteMediaUploadResult =
  | { kind: "accepted" | "existing"; status: "SCANNING" | "READY"; updatedAt: Date }
  | { kind: "invalid"; reason: "OBJECT_METADATA_MISMATCH" | "UPLOAD_EXPIRED" }
  | { kind: "conflict" }
  | { kind: "not_found" };

export type MediaProcessingRecord = {
  id: string;
  status: MediaStatus;
  lifecycleVersion: number;
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type MediaProcessedVariantInput = {
  id: string;
  kind: MediaVariantKind;
  bucket: string;
  objectKey: string;
  mimeType: "image/webp";
  byteSize: number;
  sha256: string;
  width: number;
  height: number;
};

export type FinalizeMediaProcessingInput = {
  id: string;
  lifecycleVersion: number;
  eventId: string;
  now: Date;
  detectedMimeType: string;
  width: number;
  height: number;
  variants: readonly MediaProcessedVariantInput[];
};

export type RejectMediaProcessingInput = {
  id: string;
  lifecycleVersion: number;
  eventId: string;
  now: Date;
  rejectionCode: string;
};

export type MediaProcessingMutationResult = "updated" | "existing" | "stale";

type MediaClient = PrismaClient | Prisma.TransactionClient;

const mediaUploadIntentSelect = {
  id: true,
  ownerId: true,
  purpose: true,
  kind: true,
  status: true,
  bucket: true,
  objectKey: true,
  mimeType: true,
  byteSize: true,
  sha256: true,
  idempotencyKey: true,
  requestHash: true,
  uploadExpiresAt: true,
  createdAt: true,
} satisfies Prisma.MediaAssetSelect;

type SelectedMediaUploadIntent = Prisma.MediaAssetGetPayload<{
  select: typeof mediaUploadIntentSelect;
}>;

const mediaProcessingSelect = {
  id: true,
  status: true,
  lifecycleVersion: true,
  bucket: true,
  objectKey: true,
  mimeType: true,
  byteSize: true,
  sha256: true,
} satisfies Prisma.MediaAssetSelect;

type SelectedMediaProcessingRecord = Prisma.MediaAssetGetPayload<{
  select: typeof mediaProcessingSelect;
}>;

const requiredMediaVariantKinds = [
  MediaVariantKind.THUMBNAIL,
  MediaVariantKind.CARD,
  MediaVariantKind.FULL,
] as const;

function isRepositoryOptions(
  target: MediaClient | MediaAssetRepositoryOptions,
): target is MediaAssetRepositoryOptions {
  return "connectionString" in target;
}

function mapIntent(row: SelectedMediaUploadIntent): MediaUploadIntentRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    purpose: row.purpose,
    kind: row.kind,
    status: row.status,
    bucket: row.bucket,
    objectKey: row.objectKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    uploadExpiresAt: row.uploadExpiresAt,
    createdAt: row.createdAt,
  };
}

function mapProcessingRecord(row: SelectedMediaProcessingRecord): MediaProcessingRecord {
  return { ...row };
}

function boundedRejectionCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_]/g, "_")
    .slice(0, 64);
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(normalized) ? normalized : "MEDIA_PROCESSING_REJECTED";
}

function assertCompleteVariantSet(variants: readonly MediaProcessedVariantInput[]): void {
  const actual = new Set(variants.map((variant) => variant.kind));
  if (
    variants.length !== requiredMediaVariantKinds.length ||
    requiredMediaVariantKinds.some((kind) => !actual.has(kind))
  ) {
    throw new RangeError("Media processing requires one THUMBNAIL, CARD, and FULL variant");
  }
}

export class MediaAssetRepository {
  readonly #client: MediaClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: MediaClient | MediaAssetRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult> {
    return this.#transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`media-upload:${input.ownerId}`}, 0))::text AS "lock"`,
      );

      const existing = await transaction.mediaAsset.findUnique({
        where: {
          ownerId_idempotencyKey: {
            ownerId: input.ownerId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: mediaUploadIntentSelect,
      });
      if (existing) {
        return existing.requestHash === input.requestHash
          ? { kind: "existing", intent: mapIntent(existing) }
          : { kind: "idempotency_conflict" };
      }

      const actor = await transaction.user.findFirst({
        where: {
          id: input.ownerId,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!actor) return { kind: "actor_unavailable" };

      const active = await transaction.mediaAsset.findMany({
        where: {
          ownerId: input.ownerId,
          status: MediaStatus.UPLOADING,
          uploadExpiresAt: { gt: input.now },
        },
        orderBy: [{ uploadExpiresAt: "asc" }, { id: "asc" }],
        select: { uploadExpiresAt: true },
        take: input.maximumActive,
      });
      if (active.length >= input.maximumActive) {
        return {
          kind: "active_quota_exceeded",
          retryAfter: active[0]?.uploadExpiresAt ?? input.uploadExpiresAt,
        };
      }

      const dailyWindowStart = new Date(input.now.getTime() - 86_400_000);
      const daily = await transaction.mediaAsset.aggregate({
        where: {
          ownerId: input.ownerId,
          createdAt: { gte: dailyWindowStart },
          status: { not: MediaStatus.DELETED },
        },
        _sum: { byteSize: true },
      });
      if ((daily._sum.byteSize ?? 0) + input.byteSize > input.dailyByteLimit) {
        const oldest = await transaction.mediaAsset.findFirst({
          where: {
            ownerId: input.ownerId,
            createdAt: { gte: dailyWindowStart },
            status: { not: MediaStatus.DELETED },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { createdAt: true },
        });
        return {
          kind: "daily_byte_quota_exceeded",
          retryAfter: oldest
            ? new Date(oldest.createdAt.getTime() + 86_400_000)
            : new Date(input.now.getTime() + 86_400_000),
        };
      }

      const created = await transaction.mediaAsset.create({
        data: {
          id: input.id,
          ownerId: actor.id,
          purpose: input.purpose,
          kind: input.kind,
          bucket: input.bucket,
          objectKey: input.objectKey,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          sha256: input.sha256,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          uploadExpiresAt: input.uploadExpiresAt,
          createdAt: input.now,
        },
        select: mediaUploadIntentSelect,
      });
      return { kind: "created", intent: mapIntent(created) };
    });
  }

  async findOwnedUploadIntent(
    id: string,
    ownerId: string,
  ): Promise<MediaUploadIntentRecord | null> {
    const row = await this.#client.mediaAsset.findFirst({
      where: { id, ownerId },
      select: mediaUploadIntentSelect,
    });
    return row ? mapIntent(row) : null;
  }

  async findOwnedStatus(id: string, ownerId: string): Promise<OwnedMediaStatusRecord | null> {
    const row = await this.#client.mediaAsset.findFirst({
      where: {
        id,
        ownerId,
        status: { not: MediaStatus.DELETED },
      },
      select: {
        id: true,
        status: true,
        rejectionCode: true,
        updatedAt: true,
      },
    });
    if (!row || row.status === MediaStatus.DELETED) return null;
    return {
      id: row.id,
      status: row.status,
      rejectionCode: row.rejectionCode,
      updatedAt: row.updatedAt,
    };
  }

  completeUpload(input: CompleteMediaUploadInput): Promise<CompleteMediaUploadResult> {
    return this.#transaction(async (transaction) => {
      await this.#lockAsset(transaction, input.id);
      const asset = await transaction.mediaAsset.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          ownerId: true,
          status: true,
          mimeType: true,
          byteSize: true,
          sha256: true,
          uploadExpiresAt: true,
          lifecycleVersion: true,
          updatedAt: true,
        },
      });
      if (!asset || asset.ownerId !== input.ownerId) return { kind: "not_found" };
      if (asset.status === MediaStatus.SCANNING || asset.status === MediaStatus.READY) {
        return {
          kind: "existing",
          status: asset.status,
          updatedAt: asset.updatedAt,
        };
      }
      if (asset.status !== MediaStatus.UPLOADING) return { kind: "conflict" };

      const rejectionReason =
        input.now > asset.uploadExpiresAt
          ? "UPLOAD_EXPIRED"
          : asset.byteSize !== input.observed.byteSize ||
              asset.mimeType !== input.observed.mimeType ||
              asset.sha256 !== input.observed.sha256
            ? "OBJECT_METADATA_MISMATCH"
            : null;
      if (rejectionReason) {
        const rejected = await transaction.mediaAsset.update({
          where: { id: asset.id },
          data: {
            status: MediaStatus.REJECTED,
            uploadedAt: input.now,
            processedAt: input.now,
            rejectionCode: rejectionReason,
            lifecycleVersion: { increment: 1 },
          },
          select: { lifecycleVersion: true },
        });
        await this.#appendLifecycleEvent(transaction, {
          eventId: input.eventId,
          mediaId: asset.id,
          eventType: "media.processing.rejected",
          lifecycleVersion: rejected.lifecycleVersion,
          occurredAt: input.now,
          extra: { rejectionCode: rejectionReason },
        });
        return { kind: "invalid", reason: rejectionReason };
      }

      const scanning = await transaction.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaStatus.SCANNING,
          uploadedAt: input.now,
          scanStartedAt: input.now,
          lifecycleVersion: { increment: 1 },
        },
        select: { lifecycleVersion: true, updatedAt: true },
      });
      await this.#appendLifecycleEvent(transaction, {
        eventId: input.eventId,
        mediaId: asset.id,
        eventType: "media.upload.completed",
        lifecycleVersion: scanning.lifecycleVersion,
        occurredAt: input.now,
      });
      return { kind: "accepted", status: "SCANNING", updatedAt: scanning.updatedAt };
    });
  }

  async getForProcessing(id: string): Promise<MediaProcessingRecord | null> {
    const row = await this.#client.mediaAsset.findUnique({
      where: { id },
      select: mediaProcessingSelect,
    });
    return row ? mapProcessingRecord(row) : null;
  }

  async finalizeProcessing(
    input: FinalizeMediaProcessingInput,
  ): Promise<MediaProcessingMutationResult> {
    assertCompleteVariantSet(input.variants);
    return this.#transaction(async (transaction) => {
      await this.#lockAsset(transaction, input.id);
      const asset = await transaction.mediaAsset.findUnique({
        where: { id: input.id },
        select: { status: true, lifecycleVersion: true },
      });
      if (!asset) return "stale";
      if (asset.status === MediaStatus.READY) return "existing";
      if (
        asset.status !== MediaStatus.SCANNING ||
        asset.lifecycleVersion !== input.lifecycleVersion
      ) {
        return "stale";
      }

      for (const variant of input.variants) {
        await transaction.mediaVariant.upsert({
          where: {
            mediaAssetId_kind: {
              mediaAssetId: input.id,
              kind: variant.kind,
            },
          },
          create: {
            ...variant,
            mediaAssetId: input.id,
            createdAt: input.now,
          },
          update: {
            bucket: variant.bucket,
            objectKey: variant.objectKey,
            mimeType: variant.mimeType,
            byteSize: variant.byteSize,
            sha256: variant.sha256,
            width: variant.width,
            height: variant.height,
          },
        });
      }
      const ready = await transaction.mediaAsset.update({
        where: { id: input.id },
        data: {
          status: MediaStatus.READY,
          detectedMimeType: input.detectedMimeType,
          width: input.width,
          height: input.height,
          processedAt: input.now,
          rejectionCode: null,
          lifecycleVersion: { increment: 1 },
        },
        select: { lifecycleVersion: true },
      });
      await this.#appendLifecycleEvent(transaction, {
        eventId: input.eventId,
        mediaId: input.id,
        eventType: "media.processing.ready",
        lifecycleVersion: ready.lifecycleVersion,
        occurredAt: input.now,
      });
      return "updated";
    });
  }

  rejectProcessing(input: RejectMediaProcessingInput): Promise<MediaProcessingMutationResult> {
    return this.#transaction(async (transaction) => {
      await this.#lockAsset(transaction, input.id);
      const asset = await transaction.mediaAsset.findUnique({
        where: { id: input.id },
        select: { status: true, lifecycleVersion: true },
      });
      if (!asset) return "stale";
      if (asset.status === MediaStatus.REJECTED) return "existing";
      if (
        asset.status !== MediaStatus.SCANNING ||
        asset.lifecycleVersion !== input.lifecycleVersion
      ) {
        return "stale";
      }
      const rejectionCode = boundedRejectionCode(input.rejectionCode);
      const rejected = await transaction.mediaAsset.update({
        where: { id: input.id },
        data: {
          status: MediaStatus.REJECTED,
          processedAt: input.now,
          rejectionCode,
          lifecycleVersion: { increment: 1 },
        },
        select: { lifecycleVersion: true },
      });
      await this.#appendLifecycleEvent(transaction, {
        eventId: input.eventId,
        mediaId: input.id,
        eventType: "media.processing.rejected",
        lifecycleVersion: rejected.lifecycleVersion,
        occurredAt: input.now,
        extra: { rejectionCode },
      });
      return "updated";
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) {
      return this.#client.$transaction(callback, { maxWait: 5_000, timeout: 10_000 });
    }
    return callback(this.#client);
  }

  async #lockAsset(transaction: Prisma.TransactionClient, id: string): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id"::text FROM "media_assets" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
  }

  async #appendLifecycleEvent(
    transaction: Prisma.TransactionClient,
    input: {
      eventId: string;
      mediaId: string;
      eventType: string;
      lifecycleVersion: number;
      occurredAt: Date;
      extra?: Record<string, Prisma.JsonValue>;
    },
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        id: input.eventId,
        aggregateType: "MEDIA_ASSET",
        aggregateId: input.mediaId,
        eventType: input.eventType,
        payload: {
          mediaId: input.mediaId,
          lifecycleVersion: input.lifecycleVersion,
          ...(input.extra ?? {}),
        },
        availableAt: input.occurredAt,
        createdAt: input.occurredAt,
      },
    });
  }
}
