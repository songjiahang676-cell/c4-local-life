import { describe, expect, it } from "vitest";
import { createUploadRequestSchema, idempotencyKeySchema, mediaStatusResponseSchema } from "../src";

describe("media upload contracts", () => {
  it("accepts only bounded owner status without storage metadata", () => {
    const valid = {
      data: {
        mediaId: "00000000-0000-4000-8000-000000000001",
        status: "READY",
        rejectionCode: null,
        updatedAt: "2026-07-29T01:00:00.000Z",
      },
    } as const;
    expect(mediaStatusResponseSchema.parse(valid)).toEqual(valid);
    expect(
      mediaStatusResponseSchema.safeParse({
        ...valid,
        data: { ...valid.data, bucket: "private-media" },
      }).success,
    ).toBe(false);
    expect(
      mediaStatusResponseSchema.safeParse({
        ...valid,
        data: { ...valid.data, status: "DELETED" },
      }).success,
    ).toBe(false);
  });

  const valid = {
    filename: "客厅照片.webp",
    mimeType: "image/webp" as const,
    byteSize: 1_024,
    sha256: "a".repeat(64),
    purpose: "LISTING_MEDIA" as const,
  };

  it("accepts a bounded image declaration and canonical checksum", () => {
    expect(createUploadRequestSchema.parse(valid)).toEqual(valid);
    expect(idempotencyKeySchema.parse("media-upload-key-0001")).toBe("media-upload-key-0001");
  });

  it("rejects traversal, bidi controls, uppercase checksums and unknown fields", () => {
    for (const filename of ["../photo.webp", `photo\u202ephp.webp`, "folder/photo.webp"]) {
      expect(createUploadRequestSchema.safeParse({ ...valid, filename }).success, filename).toBe(
        false,
      );
    }
    expect(createUploadRequestSchema.safeParse({ ...valid, sha256: "A".repeat(64) }).success).toBe(
      false,
    );
    expect(
      createUploadRequestSchema.safeParse({ ...valid, internalBucket: "public" }).success,
    ).toBe(false);
  });

  it("rejects oversized declarations and unsafe idempotency keys", () => {
    expect(createUploadRequestSchema.safeParse({ ...valid, byteSize: 20_971_521 }).success).toBe(
      false,
    );
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse(`media-upload-key\n0001`).success).toBe(false);
    expect(idempotencyKeySchema.safeParse("media-upload-key-1,media-upload-key-2").success).toBe(
      false,
    );
  });
});
