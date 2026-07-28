import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseWorkerEnvironment } from "@socal/config";
import { MediaStatus, type MediaProcessingRecord } from "@socal/database/media";
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3MediaProcessingStorage } from "../src/media/s3-media-processing.storage";

const environment = parseWorkerEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "synthetic-access-key",
  S3_SECRET_KEY: "synthetic-secret-key",
  S3_FORCE_PATH_STYLE: "true",
});

const record: MediaProcessingRecord = {
  id: "70000000-0000-4000-8000-000000000031",
  status: MediaStatus.SCANNING,
  lifecycleVersion: 1,
  bucket: "private-quarantine",
  objectKey: "quarantine/70/70000000-0000-4000-8000-000000000031/original",
  mimeType: "image/jpeg",
  byteSize: 6,
  sha256: "a".repeat(64),
};

describe("S3MediaProcessingStorage", () => {
  let storage: S3MediaProcessingStorage | undefined;

  afterEach(() => {
    storage?.close();
    storage = undefined;
    vi.restoreAllMocks();
  });

  it("range-bounds quarantine reads and writes encrypted immutable derivatives", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: () =>
            Promise.resolve(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])),
        },
      } as never)
      .mockResolvedValueOnce({} as never);
    storage = new S3MediaProcessingStorage(environment);

    await expect(storage.readSource(record, 20_971_520)).resolves.toHaveLength(6);
    await storage.putVariant({
      bucket: "safe-processed",
      objectKey: `processed/70/${record.id}/full.webp`,
      mediaId: record.id,
      variant: {
        kind: "FULL",
        data: Buffer.from("safe-webp"),
        mimeType: "image/webp",
        width: 640,
        height: 480,
      },
      sha256: "b".repeat(64),
    });

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0]?.[0] as GetObjectCommand).input).toMatchObject({
      Bucket: record.bucket,
      Key: record.objectKey,
      Range: "bytes=0-20971520",
    });
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[1]?.[0] as PutObjectCommand).input).toMatchObject({
      Bucket: "safe-processed",
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
      ServerSideEncryption: "AES256",
      Metadata: {
        "media-id": record.id,
        "content-sha256": "b".repeat(64),
        variant: "full",
      },
    });
  });

  it("rejects oversized or truncated source objects without decoding", async () => {
    storage = new S3MediaProcessingStorage(environment);
    await expect(
      storage.readSource({ ...record, byteSize: 20_971_521 }, 20_971_520),
    ).rejects.toMatchObject({ code: "SOURCE_SIZE_MISMATCH" });
  });
});
