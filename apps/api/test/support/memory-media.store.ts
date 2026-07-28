import type {
  MediaStore,
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "../../src/modules/media/media.store";
import type {
  IssueQuarantineUploadInput,
  MediaObjectStorage,
  QuarantineUploadTarget,
} from "../../src/modules/media/media-object-storage";

export class MemoryMediaStore implements MediaStore {
  readonly inputs: ReserveMediaUploadIntentInput[] = [];
  readonly intents = new Map<string, MediaUploadIntentRecord>();
  nextResult: ReserveMediaUploadIntentResult | null = null;

  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult> {
    this.inputs.push(input);
    if (this.nextResult) {
      const result = this.nextResult;
      this.nextResult = null;
      return Promise.resolve(result);
    }
    const idempotencyIndex = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.intents.get(idempotencyIndex);
    if (existing) {
      return Promise.resolve(
        existing.requestHash === input.requestHash
          ? { kind: "existing", intent: existing }
          : { kind: "idempotency_conflict" },
      );
    }
    const intent: MediaUploadIntentRecord = {
      id: input.id,
      ownerId: input.ownerId,
      purpose: input.purpose,
      kind: input.kind,
      status: "UPLOADING",
      bucket: input.bucket,
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      uploadExpiresAt: input.uploadExpiresAt,
      createdAt: input.now,
    };
    this.intents.set(idempotencyIndex, intent);
    return Promise.resolve({ kind: "created", intent });
  }
}

export class CapturingMediaObjectStorage implements MediaObjectStorage {
  readonly inputs: IssueQuarantineUploadInput[] = [];
  failure: Error | null = null;

  issueQuarantineUpload(input: IssueQuarantineUploadInput): Promise<QuarantineUploadTarget> {
    this.inputs.push(input);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve({
      uploadUrl: `https://quarantine.example.invalid/${input.objectKey}?signed=test`,
      headers: {
        "content-length": String(input.byteSize),
        "content-type": input.mimeType,
        "x-amz-checksum-sha256": Buffer.from(input.sha256Hex, "hex").toString("base64"),
        "x-amz-meta-content-sha256": input.sha256Hex,
        "x-amz-server-side-encryption": "AES256",
      },
    });
  }
}
