import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type {
  IssueQuarantineUploadInput,
  MediaObjectStorage,
  QuarantineObjectMetadata,
  QuarantineUploadTarget,
} from "./media-object-storage";

@Injectable()
export class S3MediaObjectStorage implements MediaObjectStorage, OnModuleDestroy {
  readonly #client: S3Client;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    const accessKeyId = environment.S3_ACCESS_KEY;
    const secretAccessKey = environment.S3_SECRET_KEY?.reveal();
    this.#client = new S3Client({
      region: environment.S3_REGION,
      endpoint: environment.S3_ENDPOINT || undefined,
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  async issueQuarantineUpload(input: IssueQuarantineUploadInput): Promise<QuarantineUploadTarget> {
    const checksumBase64 = Buffer.from(input.sha256Hex, "hex").toString("base64");
    const headers = {
      "content-length": String(input.byteSize),
      "content-type": input.mimeType,
      "x-amz-checksum-sha256": checksumBase64,
      "x-amz-meta-content-sha256": input.sha256Hex,
      "x-amz-server-side-encryption": "AES256",
    } as const;
    const expiresIn = Math.max(
      1,
      Math.ceil((input.expiresAt.getTime() - input.issuedAt.getTime()) / 1_000),
    );
    const uploadUrl = await getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        ContentLength: input.byteSize,
        ChecksumSHA256: checksumBase64,
        Metadata: { "content-sha256": input.sha256Hex },
        ServerSideEncryption: "AES256",
      }),
      {
        expiresIn,
        signingDate: input.issuedAt,
        signableHeaders: new Set(["content-type"]),
        unhoistableHeaders: new Set([
          "x-amz-checksum-sha256",
          "x-amz-meta-content-sha256",
          "x-amz-server-side-encryption",
        ]),
      },
    );
    return { uploadUrl, headers };
  }

  async inspectQuarantineObject(input: {
    bucket: string;
    objectKey: string;
  }): Promise<QuarantineObjectMetadata | null> {
    try {
      const object = await this.#client.send(
        new HeadObjectCommand({
          Bucket: input.bucket,
          Key: input.objectKey,
          ChecksumMode: "ENABLED",
        }),
      );
      const checksum = object.ChecksumSHA256
        ? Buffer.from(object.ChecksumSHA256, "base64").toString("hex")
        : "";
      return {
        byteSize: object.ContentLength ?? -1,
        mimeType: object.ContentType ?? "",
        sha256Hex: checksum || object.Metadata?.["content-sha256"] || "",
      };
    } catch (error: unknown) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return null;
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.#client.destroy();
  }
}
