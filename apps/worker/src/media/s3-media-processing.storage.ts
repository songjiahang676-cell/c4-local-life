import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnvironment } from "@socal/config";
import type { MediaProcessingRecord } from "@socal/database/media";
import {
  PermanentMediaProcessingError,
  type MediaProcessingStorage,
  type TransformedMediaVariant,
} from "./media-processing";

export class S3MediaProcessingStorage implements MediaProcessingStorage {
  readonly #client: S3Client;

  constructor(environment: WorkerEnvironment) {
    const accessKeyId = environment.S3_ACCESS_KEY;
    const secretAccessKey = environment.S3_SECRET_KEY?.reveal();
    this.#client = new S3Client({
      region: environment.S3_REGION,
      endpoint: environment.S3_ENDPOINT || undefined,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  async readSource(record: MediaProcessingRecord, maximumBytes: number): Promise<Buffer> {
    if (record.byteSize > maximumBytes) {
      throw new PermanentMediaProcessingError("SOURCE_SIZE_MISMATCH");
    }
    const object = await this.#client.send(
      new GetObjectCommand({
        Bucket: record.bucket,
        Key: record.objectKey,
        Range: `bytes=0-${maximumBytes}`,
        ChecksumMode: "ENABLED",
      }),
    );
    if (!object.Body) throw new PermanentMediaProcessingError("SOURCE_NOT_FOUND");
    const data = Buffer.from(await object.Body.transformToByteArray());
    if (data.byteLength > maximumBytes || data.byteLength !== record.byteSize) {
      throw new PermanentMediaProcessingError("SOURCE_SIZE_MISMATCH");
    }
    return data;
  }

  async putVariant(input: {
    bucket: string;
    objectKey: string;
    mediaId: string;
    variant: TransformedMediaVariant;
    sha256: string;
  }): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        Body: input.variant.data,
        ContentType: input.variant.mimeType,
        ContentLength: input.variant.data.byteLength,
        CacheControl: "public, max-age=31536000, immutable",
        ChecksumSHA256: Buffer.from(input.sha256, "hex").toString("base64"),
        Metadata: {
          "media-id": input.mediaId,
          "content-sha256": input.sha256,
          variant: input.variant.kind.toLowerCase(),
        },
        ServerSideEncryption: "AES256",
      }),
    );
  }

  close(): void {
    this.#client.destroy();
  }
}
