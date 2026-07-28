export const MEDIA_OBJECT_STORAGE = Symbol("MEDIA_OBJECT_STORAGE");

export type IssueQuarantineUploadInput = {
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
  sha256Hex: string;
  issuedAt: Date;
  expiresAt: Date;
};

export type QuarantineUploadTarget = {
  uploadUrl: string;
  headers: Readonly<Record<string, string>>;
};

export type QuarantineObjectMetadata = {
  byteSize: number;
  mimeType: string;
  sha256Hex: string;
};

export type MediaObjectStorage = {
  issueQuarantineUpload(input: IssueQuarantineUploadInput): Promise<QuarantineUploadTarget>;
  inspectQuarantineObject(input: {
    bucket: string;
    objectKey: string;
  }): Promise<QuarantineObjectMetadata | null>;
};
