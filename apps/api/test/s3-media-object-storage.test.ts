import { parseApiEnvironment } from "@socal/config";
import { afterEach, describe, expect, it } from "vitest";
import { S3MediaObjectStorage } from "../src/modules/media/s3-media-object-storage";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-s3-media-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "s3-media-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "s3-media-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "s3-media-mfa-secret-with-more-than-32-bytes",
  CSRF_SECRET: "s3-media-csrf-secret-with-more-than-32-bytes",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-west-2",
  S3_QUARANTINE_BUCKET: "socal-test-quarantine",
  S3_ACCESS_KEY: "synthetic-access-key",
  S3_SECRET_KEY: "synthetic-secret-key",
  S3_FORCE_PATH_STYLE: "true",
});

describe("S3MediaObjectStorage", () => {
  let storage: S3MediaObjectStorage | undefined;

  afterEach(() => {
    storage?.onModuleDestroy();
    storage = undefined;
  });

  it("binds content length, MIME, checksum, metadata and encryption into a short-lived PUT", async () => {
    storage = new S3MediaObjectStorage(environment);
    const mediaId = "70000000-0000-4000-8000-000000000001";
    const issuedAt = new Date("2026-07-28T20:15:00.000Z");
    const target = await storage.issueQuarantineUpload({
      bucket: environment.S3_QUARANTINE_BUCKET,
      objectKey: `quarantine/70/${mediaId}/original`,
      mimeType: "image/jpeg",
      byteSize: 512,
      sha256Hex: "a".repeat(64),
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 300_000),
    });
    const url = new URL(target.uploadUrl);

    expect(url.origin).toBe("http://localhost:9000");
    expect(url.pathname).toBe(`/socal-test-quarantine/quarantine/70/${mediaId}/original`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-meta-content-sha256");
    expect(target.headers).toMatchObject({
      "content-length": "512",
      "content-type": "image/jpeg",
      "x-amz-meta-content-sha256": "a".repeat(64),
      "x-amz-server-side-encryption": "AES256",
    });
  });
});
