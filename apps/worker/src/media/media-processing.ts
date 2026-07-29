import { createHash, randomUUID } from "node:crypto";
import type {
  MediaAssetRepository,
  MediaProcessedVariantInput,
  MediaProcessingRecord,
} from "@socal/database/media";

const expectedVariantKinds = ["THUMBNAIL", "CARD", "FULL"] as const;

export class PermanentMediaProcessingError extends Error {
  constructor(readonly code: string) {
    super("Media processing rejected the quarantined object");
    this.name = "PermanentMediaProcessingError";
  }
}

export type MalwareScanResult = "clean" | "infected";

export type MalwareScanner = {
  scan(input: Buffer): Promise<MalwareScanResult>;
};

export type TransformedMediaVariant = {
  kind: (typeof expectedVariantKinds)[number];
  data: Buffer;
  mimeType: "image/webp";
  width: number;
  height: number;
};

export type ImageTransformation = {
  width: number;
  height: number;
  perceptualHash: string;
  variants: readonly TransformedMediaVariant[];
};

export type ImageTransformer = {
  transform(input: Buffer): Promise<ImageTransformation>;
};

export type MediaProcessingStorage = {
  readSource(record: MediaProcessingRecord, maximumBytes: number): Promise<Buffer>;
  putVariant(input: {
    bucket: string;
    objectKey: string;
    mediaId: string;
    variant: TransformedMediaVariant;
    sha256: string;
  }): Promise<void>;
};

export type MediaProcessingStore = Pick<
  MediaAssetRepository,
  "getForProcessing" | "finalizeProcessing" | "rejectProcessing"
>;

function processingEvent(input: unknown): { mediaId: string; lifecycleVersion: number } {
  if (!input || typeof input !== "object") throw new PermanentMediaProcessingError("EVENT_INVALID");
  const event = input as Record<string, unknown>;
  if (
    event.version !== 1 ||
    event.eventType !== "media.upload.completed" ||
    typeof event.payload !== "object" ||
    !event.payload
  ) {
    throw new PermanentMediaProcessingError("EVENT_INVALID");
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    typeof payload.mediaId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.mediaId,
    ) ||
    !Number.isInteger(payload.lifecycleVersion) ||
    Number(payload.lifecycleVersion) <= 0
  ) {
    throw new PermanentMediaProcessingError("EVENT_INVALID");
  }
  return {
    mediaId: payload.mediaId,
    lifecycleVersion: Number(payload.lifecycleVersion),
  };
}

function variantKey(mediaId: string, kind: TransformedMediaVariant["kind"]): string {
  return `processed/${mediaId.slice(0, 2)}/${mediaId}/${kind.toLowerCase()}.webp`;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function detectedImageMimeType(value: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (value.byteLength >= 3 && value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    value.byteLength >= 8 &&
    value.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    value.byteLength >= 12 &&
    value.subarray(0, 4).toString("ascii") === "RIFF" &&
    value.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export class MediaProcessingHandler {
  constructor(
    private readonly store: MediaProcessingStore,
    private readonly storage: MediaProcessingStorage,
    private readonly scanner: MalwareScanner,
    private readonly transformer: ImageTransformer,
    private readonly configuration: {
      maximumBytes: number;
      processedBucket: string;
      onOutcome: (outcome: "ready" | "rejected" | "stale") => void;
    },
  ) {}

  async handle(input: unknown): Promise<void> {
    const event = processingEvent(input);
    const record = await this.store.getForProcessing(event.mediaId);
    if (!record || record.status === "READY" || record.status === "REJECTED") {
      this.configuration.onOutcome("stale");
      return;
    }
    if (record.status !== "SCANNING" || record.lifecycleVersion !== event.lifecycleVersion) {
      this.configuration.onOutcome("stale");
      return;
    }

    try {
      const source = await this.storage.readSource(record, this.configuration.maximumBytes);
      if (source.byteLength !== record.byteSize || sha256(source) !== record.sha256) {
        throw new PermanentMediaProcessingError("SOURCE_INTEGRITY_MISMATCH");
      }
      const detectedMimeType = detectedImageMimeType(source);
      if (!detectedMimeType || detectedMimeType !== record.mimeType) {
        throw new PermanentMediaProcessingError("UNSUPPORTED_MEDIA_TYPE");
      }
      if ((await this.scanner.scan(source)) === "infected") {
        throw new PermanentMediaProcessingError("MALWARE_DETECTED");
      }

      const transformed = await this.transformer.transform(source);
      if (
        transformed.variants.length !== expectedVariantKinds.length ||
        expectedVariantKinds.some(
          (kind) => !transformed.variants.some((variant) => variant.kind === kind),
        )
      ) {
        throw new PermanentMediaProcessingError("VARIANT_SET_INVALID");
      }

      const variants: MediaProcessedVariantInput[] = [];
      for (const variant of transformed.variants) {
        const digest = sha256(variant.data);
        const objectKey = variantKey(record.id, variant.kind);
        await this.storage.putVariant({
          bucket: this.configuration.processedBucket,
          objectKey,
          mediaId: record.id,
          variant,
          sha256: digest,
        });
        variants.push({
          id: randomUUID(),
          kind: variant.kind,
          bucket: this.configuration.processedBucket,
          objectKey,
          mimeType: variant.mimeType,
          byteSize: variant.data.byteLength,
          sha256: digest,
          width: variant.width,
          height: variant.height,
        });
      }

      const result = await this.store.finalizeProcessing({
        id: record.id,
        lifecycleVersion: record.lifecycleVersion,
        eventId: randomUUID(),
        now: new Date(),
        detectedMimeType,
        width: transformed.width,
        height: transformed.height,
        perceptualHash: transformed.perceptualHash,
        variants,
      });
      this.configuration.onOutcome(result === "updated" ? "ready" : "stale");
    } catch (error: unknown) {
      if (!(error instanceof PermanentMediaProcessingError)) throw error;
      const result = await this.store.rejectProcessing({
        id: record.id,
        lifecycleVersion: record.lifecycleVersion,
        eventId: randomUUID(),
        now: new Date(),
        rejectionCode: error.code,
      });
      this.configuration.onOutcome(result === "updated" ? "rejected" : "stale");
    }
  }
}
