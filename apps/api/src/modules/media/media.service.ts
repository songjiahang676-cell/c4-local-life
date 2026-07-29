import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  CreateUploadRequest,
  CreateUploadResponse,
  MediaProcessingResponse,
  MediaStatusResponse,
} from "@socal/contracts";
import type { MediaKind, MediaPurpose } from "@socal/database/media";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  activeUserPolicyActions,
  PolicyService,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import {
  MEDIA_OBJECT_STORAGE,
  type MediaObjectStorage,
  type QuarantineUploadTarget,
} from "./media-object-storage";
import { MEDIA_STORE, type MediaStore, type MediaUploadIntentRecord } from "./media.store";

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const purposeByteLimits: Record<Exclude<MediaPurpose, "VERIFICATION">, number> = {
  LISTING_MEDIA: 20_971_520,
  AVATAR: 8_388_608,
  BUSINESS_LOGO: 8_388_608,
  AD_CREATIVE: 20_971_520,
};

export class MediaDeclarationUnsupportedError extends Error {
  constructor() {
    super("The declared media purpose and type are not available");
    this.name = "MediaDeclarationUnsupportedError";
  }
}

export class MediaFileTooLargeError extends Error {
  constructor() {
    super("The declared file exceeds its purpose limit");
    this.name = "MediaFileTooLargeError";
  }
}

export class MediaIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used with a different upload declaration");
    this.name = "MediaIdempotencyConflictError";
  }
}

export class MediaUploadQuotaExceededError extends Error {
  constructor(readonly retryAfter: Date) {
    super("Media upload quota exceeded");
    this.name = "MediaUploadQuotaExceededError";
  }
}

export class MediaStorageUnavailableError extends Error {
  constructor() {
    super("Private media storage is unavailable");
    this.name = "MediaStorageUnavailableError";
  }
}

export class MediaUploadNotFoundError extends Error {
  constructor() {
    super("Media upload is unavailable");
    this.name = "MediaUploadNotFoundError";
  }
}

export class MediaUploadStateConflictError extends Error {
  constructor() {
    super("Media upload cannot be completed from its current state");
    this.name = "MediaUploadStateConflictError";
  }
}

export class MediaObjectInvalidError extends Error {
  constructor() {
    super("The quarantined object does not match the upload declaration");
    this.name = "MediaObjectInvalidError";
  }
}

function authenticatedUserId(context: PolicyRequestContext): string {
  if (context.actor.kind === "guest") {
    throw new UnauthorizedException("Authentication required");
  }
  return context.actor.userId;
}

function requestHash(input: CreateUploadRequest): string {
  return createHash("sha256")
    .update("socal-media-upload-intent-v1\0", "utf8")
    .update(
      JSON.stringify({
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256,
        purpose: input.purpose,
      }),
      "utf8",
    )
    .digest("hex");
}

function mediaKind(input: CreateUploadRequest): MediaKind {
  if (!imageMimeTypes.has(input.mimeType) || input.purpose === "VERIFICATION") {
    throw new MediaDeclarationUnsupportedError();
  }
  return "IMAGE";
}

function assertPurposeSize(input: CreateUploadRequest): void {
  if (input.purpose === "VERIFICATION") throw new MediaDeclarationUnsupportedError();
  if (input.byteSize > purposeByteLimits[input.purpose]) {
    throw new MediaFileTooLargeError();
  }
}

function toResponse(
  intent: MediaUploadIntentRecord,
  target: QuarantineUploadTarget,
): CreateUploadResponse {
  return {
    data: {
      mediaId: intent.id,
      uploadUrl: target.uploadUrl,
      method: "PUT",
      headers: { ...target.headers },
      expiresAt: intent.uploadExpiresAt.toISOString(),
    },
  };
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
    @Inject(MEDIA_OBJECT_STORAGE) private readonly storage: MediaObjectStorage,
    private readonly policies: PolicyService,
  ) {}

  async createUploadIntent(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateUploadRequest,
  ): Promise<CreateUploadResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.mediaUploadCreate,
      context,
    });
    const ownerId = authenticatedUserId(context);
    assertPurposeSize(input);
    const kind = mediaKind(input);
    const now = new Date();
    const mediaId = randomUUID();
    const uploadExpiresAt = new Date(
      now.getTime() + this.environment.MEDIA_UPLOAD_URL_TTL_SECONDS * 1_000,
    );
    const result = await this.store.reserveUploadIntent({
      id: mediaId,
      ownerId,
      purpose: input.purpose,
      kind,
      bucket: this.environment.S3_QUARANTINE_BUCKET,
      objectKey: `quarantine/${mediaId.slice(0, 2)}/${mediaId}/original`,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      idempotencyKey,
      requestHash: requestHash(input),
      now,
      uploadExpiresAt,
      maximumActive: this.environment.MEDIA_UPLOAD_MAX_ACTIVE,
      dailyByteLimit: this.environment.MEDIA_UPLOAD_DAILY_BYTES,
    });

    if (result.kind === "idempotency_conflict") {
      throw new MediaIdempotencyConflictError();
    }
    if (result.kind === "active_quota_exceeded" || result.kind === "daily_byte_quota_exceeded") {
      throw new MediaUploadQuotaExceededError(result.retryAfter);
    }
    if (result.kind === "actor_unavailable") {
      throw new UnauthorizedException("Authentication required");
    }

    try {
      const target = await this.storage.issueQuarantineUpload({
        bucket: result.intent.bucket,
        objectKey: result.intent.objectKey,
        mimeType: result.intent.mimeType,
        byteSize: result.intent.byteSize,
        sha256Hex: result.intent.sha256,
        issuedAt: result.intent.createdAt,
        expiresAt: result.intent.uploadExpiresAt,
      });
      return toResponse(result.intent, target);
    } catch {
      throw new MediaStorageUnavailableError();
    }
  }

  async completeUpload(
    context: PolicyRequestContext,
    mediaId: string,
  ): Promise<MediaProcessingResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.mediaUploadComplete,
      context,
    });
    const ownerId = authenticatedUserId(context);
    const intent = await this.store.findOwnedUploadIntent(mediaId, ownerId);
    if (!intent) throw new MediaUploadNotFoundError();

    let observed = {
      byteSize: intent.byteSize,
      mimeType: intent.mimeType,
      sha256: intent.sha256,
    };
    if (intent.status === "UPLOADING") {
      try {
        const object = await this.storage.inspectQuarantineObject({
          bucket: intent.bucket,
          objectKey: intent.objectKey,
        });
        observed = object
          ? {
              byteSize: object.byteSize,
              mimeType: object.mimeType,
              sha256: object.sha256Hex,
            }
          : { byteSize: -1, mimeType: "", sha256: "" };
      } catch {
        throw new MediaStorageUnavailableError();
      }
    }

    const result = await this.store.completeUpload({
      id: mediaId,
      ownerId,
      eventId: randomUUID(),
      now: new Date(),
      observed,
    });
    if (result.kind === "not_found") throw new MediaUploadNotFoundError();
    if (result.kind === "conflict") throw new MediaUploadStateConflictError();
    if (result.kind === "invalid") throw new MediaObjectInvalidError();
    return {
      data: {
        mediaId,
        status: result.status,
        updatedAt: result.updatedAt.toISOString(),
      },
    };
  }

  async getStatus(context: PolicyRequestContext, mediaId: string): Promise<MediaStatusResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.mediaUploadComplete,
      context,
    });
    const ownerId = authenticatedUserId(context);
    const asset = await this.store.findOwnedStatus(mediaId, ownerId);
    if (!asset) throw new MediaUploadNotFoundError();
    return {
      data: {
        mediaId: asset.id,
        status: asset.status,
        rejectionCode: asset.rejectionCode,
        updatedAt: asset.updatedAt.toISOString(),
      },
    };
  }
}
