import type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  MediaStore,
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "../../src/modules/media/media.store";
import type {
  IssueQuarantineUploadInput,
  MediaObjectStorage,
  QuarantineObjectMetadata,
  QuarantineUploadTarget,
} from "../../src/modules/media/media-object-storage";

export class MemoryMediaStore implements MediaStore {
  readonly inputs: ReserveMediaUploadIntentInput[] = [];
  readonly completionInputs: CompleteMediaUploadInput[] = [];
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

  findOwnedUploadIntent(id: string, ownerId: string): Promise<MediaUploadIntentRecord | null> {
    const intent = [...this.intents.values()].find(
      (candidate) => candidate.id === id && candidate.ownerId === ownerId,
    );
    return Promise.resolve(intent ?? null);
  }

  completeUpload(input: CompleteMediaUploadInput): Promise<CompleteMediaUploadResult> {
    this.completionInputs.push(input);
    const intent = [...this.intents.values()].find(
      (candidate) => candidate.id === input.id && candidate.ownerId === input.ownerId,
    );
    if (!intent) return Promise.resolve({ kind: "not_found" });
    if (intent.status === "SCANNING" || intent.status === "READY") {
      return Promise.resolve({
        kind: "existing",
        status: intent.status,
        updatedAt: input.now,
      });
    }
    if (intent.status !== "UPLOADING") return Promise.resolve({ kind: "conflict" });
    if (
      intent.byteSize !== input.observed.byteSize ||
      intent.mimeType !== input.observed.mimeType ||
      intent.sha256 !== input.observed.sha256
    ) {
      intent.status = "REJECTED";
      return Promise.resolve({ kind: "invalid", reason: "OBJECT_METADATA_MISMATCH" });
    }
    intent.status = "SCANNING";
    return Promise.resolve({ kind: "accepted", status: "SCANNING", updatedAt: input.now });
  }
}

export class CapturingMediaObjectStorage implements MediaObjectStorage {
  readonly inputs: IssueQuarantineUploadInput[] = [];
  failure: Error | null = null;
  inspection: QuarantineObjectMetadata | null = null;

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

  inspectQuarantineObject(): Promise<QuarantineObjectMetadata | null> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(this.inspection);
  }
}
