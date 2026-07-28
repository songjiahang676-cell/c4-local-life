import { PrismaPg } from "@prisma/adapter-pg";
import {
  MediaStatus,
  Prisma,
  PrismaClient,
  UserStatus,
  type MediaKind,
  type MediaPurpose,
} from "../../generated/prisma/client";

export { MediaKind, MediaPurpose, MediaStatus } from "../../generated/prisma/client";

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

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if ("$transaction" in this.#client) {
      return this.#client.$transaction(callback, { maxWait: 5_000, timeout: 10_000 });
    }
    return callback(this.#client);
  }
}
